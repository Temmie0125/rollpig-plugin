// 预约 / 聚众烤猪状态机（单进程本地版）。
// pending -> ready -> processing -> ready_to_send -> sending -> completed
// 结果在第一次产出后固定为 outcome_snapshot，重试只重发，不重新随机。
import crypto from 'crypto'
import { getState, mutateState } from '../state.js'
import { nowIso, todayStr } from '../time.js'
import {
  canBackfireRoast,
  expertLevel,
  getPigById,
  isEatenPig,
  isFoodPig,
  isHumanPig,
  isSoldPig,
  pickFoodPig
} from '../pigs.js'
import { formatText, pickText, texts } from '../texts.js'
import { buildBackfireOutcome, buildSuccessOutcome } from './flow.js'
import { formatCooldown, normalizeChargeSettings, consumeChargeInState, consumeForceInState } from './charges.js'
import { protectionLevel, protectionRequired } from './protection.js'
import { buildEventRecord } from './events.js'
import { recordGroupRoll } from '../daily.js'

const MAX_PARTICIPANTS = 12
const FEED_MAX_LEVEL = 5
const log = () => globalThis.logger || console

const reservationList = state => state.reservations || (state.reservations = {})

const view = reservation => {
  if (!reservation) return null
  const participants = Array.isArray(reservation.participants) ? reservation.participants : []
  return {
    ...reservation,
    participants,
    participant_count: participants.length,
    contribution_count: participants.reduce((sum, item) => sum + Math.max(1, Math.trunc(Number(item?.contribution) || 1)), 0)
  }
}

const findPending = (state, date, groupId, targetId) =>
  Object.values(reservationList(state)).find(item =>
    item && item.date_str === date && item.group_id === String(groupId) &&
    item.target_id === String(targetId) && item.status === 'pending'
  ) || null

const findBlocking = (state, date, groupId, targetId) =>
  Object.values(reservationList(state)).find(item =>
    item && item.date_str === date && item.group_id === String(groupId) &&
    item.target_id === String(targetId) &&
    ['ready', 'processing', 'ready_to_send', 'sending', 'completed'].includes(item.status)
  ) || null

const readiness = (reservation, targetPigId, protectionRequiredValue) => {
  if (!targetPigId) return false
  if (reservation.force_mode === 'super') return true
  if (!protectionRequiredValue) return true
  return reservation.participants.reduce(
    (sum, item) => sum + Math.max(1, Math.trunc(Number(item?.contribution) || 1)),
    0
  ) >= protectionRequiredValue
}

const refreshReady = reservation => {
  if (reservation.status !== 'pending') return
  if (readiness(reservation, reservation.target_pig_id, reservation.protection_required || 0)) {
    reservation.status = 'ready'
    reservation.ready_at = nowIso()
    delete reservation.waiting_notice
  }
}

const participant = (reservation, userId) =>
  (reservation.participants || []).find(item => String(item.user_id) === String(userId)) || null

const joinInState = (state, reservation, { attackerId, attackerName, attackerPigId, forceMode, date }) => {
  const uid = String(attackerId)
  if (reservation.force_mode === 'super') {
    const operator = String(reservation.force_operator_id || reservation.owner_id)
    return {
      status: operator === uid ? 'already_joined' : 'reservation_closed',
      reservation: view(reservation)
    }
  }

  if (forceMode === 'super') {
    reservation.force_feed_user_ids = (reservation.participants || [])
      .filter(item => String(item.user_id) !== uid &&
        (!reservation.protection_required || Math.trunc(Number(item.contribution) || 1) === 1))
      .map(item => String(item.user_id))
    reservation.force_operator_id = uid
    reservation.force_operator_name = String(attackerName)
    reservation.force_mode = 'super'
    recordGroupRoll(state, date, reservation.group_id, uid, attackerPigId)
    refreshReady(reservation)
    return { status: 'reservation_joined', reservation: view(reservation) }
  }

  const existing = participant(reservation, uid)
  const boosted = Boolean(reservation.protection_required && forceMode === 'normal')
  if (existing && !(boosted && Math.trunc(Number(existing.contribution) || 1) < 2)) {
    return { status: 'already_joined', reservation: view(reservation) }
  }
  if (!existing && (reservation.participants || []).length >= MAX_PARTICIPANTS) {
    return { status: 'reservation_full', reservation: view(reservation) }
  }
  if (boosted && !consumeForceInState(state, uid, date)) {
    return { status: 'force_denied', reservation: view(reservation) }
  }
  const upgraded = Boolean(existing && boosted)
  if (!existing) {
    reservation.participants ||= []
    reservation.participants.push({
      user_id: uid,
      display_name: String(attackerName),
      pig_id: String(attackerPigId),
      contribution: boosted ? 2 : 1
    })
  } else if (boosted) {
    existing.contribution = 2
  }
  recordGroupRoll(state, date, reservation.group_id, uid, attackerPigId)
  reservation.waiting_notice = false
  refreshReady(reservation)
  return { status: upgraded ? 'reservation_upgraded' : 'reservation_joined', reservation: view(reservation) }
}

/**
 * 原子准备一次烤群友：目标已抽猪且未受保护时返回 target_ready（由命令层扣费并立即结算）；
 * 否则创建/加入预约，并在创建时扣普通充能或加急次数。
 */
export const prepareRoastReservation = async ({
  attackerId,
  attackerName,
  attackerPigId,
  targetId,
  targetName,
  groupId,
  forceMode = null,
  date = todayStr(),
  config = {}
}) => {
  const targetDate = String(date)
  const gid = String(groupId)
  const tid = String(targetId)
  const uid = String(attackerId)
  const { cooldown, chargeMax } = normalizeChargeSettings({ config })
  return mutateState(state => {
    const targetPigId = state.history?.[targetDate]?.[tid] || ''
    const level = protectionLevel(targetDate, gid, tid)
    const protectedTarget = level > 0
    const existing = findPending(state, targetDate, gid, tid)
    if (existing) {
      return joinInState(state, existing, {
        attackerId: uid,
        attackerName,
        attackerPigId,
        forceMode,
        date: targetDate
      })
    }
    const blocking = findBlocking(state, targetDate, gid, tid)
    if (blocking) return { status: 'reservation_busy', reservation: view(blocking) }

    if (targetPigId && !protectedTarget) {
      return {
        status: 'target_ready',
        target_pig_id: String(targetPigId),
        force_mode: forceMode || ''
      }
    }

    const now = Date.now() / 1000
    let cooldownResult = null
    if (forceMode === 'normal') {
      if (!consumeForceInState(state, uid, targetDate)) return { status: 'force_denied' }
    } else if (forceMode !== 'super') {
      cooldownResult = consumeChargeInState(state, uid, now, cooldown, chargeMax)
      if (!cooldownResult.allowed) return { status: 'cooldown_denied', cooldown: cooldownResult }
    }

    const reservationId = crypto.randomUUID().replace(/-/g, '')
    const required = protectedTarget ? protectionRequired(level) : 0
    const participantEntry = {
      user_id: uid,
      display_name: String(attackerName),
      pig_id: String(attackerPigId),
      contribution: protectedTarget && forceMode === 'normal' ? 2 : 1
    }
    const reservation = {
      reservation_id: reservationId,
      date_str: targetDate,
      group_id: gid,
      target_id: tid,
      target_name: String(targetName),
      target_pig_id: String(targetPigId || ''),
      owner_id: uid,
      owner_name: String(attackerName),
      owner_pig_id: String(attackerPigId),
      participants: [participantEntry],
      force_mode: forceMode || '',
      force_operator_id: '',
      force_operator_name: '',
      force_feed_user_ids: [],
      protection_required: required,
      protection_level: protectedTarget ? level : 0,
      protection_source: 'daily',
      status: 'pending',
      waiting_notice: !targetPigId && !required ? true : false,
      created_at: nowIso(),
      notice_message_id: '',
      notice_bot_id: '',
      outcome_snapshot: null,
      feed_results: null,
      protection_upgrade: null,
      delivery_attempts: 0
    }
    refreshReady(reservation)
    reservationList(state)[reservationId] = reservation
    recordGroupRoll(state, targetDate, gid, uid, attackerPigId)
    return { status: 'reservation_created', reservation: view(reservation), cooldown: cooldownResult }
  })
}

/** 回复预约通知加入 */
export const joinReservationByMessage = async ({
  messageId,
  groupId,
  attackerId,
  attackerName,
  date = todayStr()
}) => mutateState(state => {
  const gid = String(groupId)
  const target = Object.values(reservationList(state)).find(item =>
    item && String(item.notice_message_id || '') === String(messageId) &&
    String(item.group_id || '') === gid
  )
  if (!target) return { status: 'message_not_found' }
  if (target.status !== 'pending') return { status: 'reservation_busy', reservation: view(target) }
  if (String(target.target_id) === String(attackerId)) return { status: 'self_target', reservation: view(target) }
  const attackerPigId = state.history?.[date]?.[String(attackerId)] || ''
  if (!attackerPigId) return { status: 'attacker_unrolled', reservation: view(target) }
  return joinInState(state, target, {
    attackerId,
    attackerName,
    attackerPigId,
    forceMode: null,
    date
  })
})

export const bindReservationMessage = async (reservationId, messageId, botId = '') => mutateState(state => {
  const reservation = reservationList(state)[String(reservationId)]
  if (!reservation) return false
  reservation.notice_message_id = String(messageId || '')
  reservation.notice_bot_id = String(botId || '')
  return true
})

/** 目标抽猪后激活所有待开炉预约 */
export const activateReservationsForTarget = async ({ targetId, targetPigId, date = todayStr() }) => mutateState(state => {
  const result = []
  for (const reservation of Object.values(reservationList(state))) {
    if (!reservation || reservation.date_str !== date) continue
    if (String(reservation.target_id) !== String(targetId)) continue
    if (reservation.status !== 'pending') continue
    reservation.target_pig_id = String(targetPigId)
    refreshReady(reservation)
    if (reservation.status === 'pending' && reservation.protection_required) {
      reservation.waiting_notice = true
    }
    result.push({ id: reservation.reservation_id, status: reservation.status })
  }
  return result
})

export const pendingReservationForTarget = (date, groupId, targetId) =>
  findPending(getState(), date, String(groupId), String(targetId))

export const claimBuildableReservations = async ({ groupId = '' } = {}) => {
  const hasReady = Object.values(getState().reservations || {}).some(reservation =>
    reservation && reservation.status === 'ready' &&
    (!groupId || reservation.group_id === String(groupId))
  )
  if (!hasReady) return []
  return mutateState(state => {
    const claimed = []
    for (const reservation of Object.values(reservationList(state))) {
      if (!reservation || reservation.status !== 'ready') continue
      if (groupId && reservation.group_id !== String(groupId)) continue
      reservation.status = 'processing'
      reservation.processing_at = nowIso()
      claimed.push(view(reservation))
    }
    return claimed
  })
}

export const releaseBuildReservation = async reservationId => mutateState(state => {
  const reservation = reservationList(state)[String(reservationId)]
  if (reservation && reservation.status === 'processing') {
    reservation.status = 'ready'
    reservation.processing_at = ''
  }
})

export const claimSendableReservations = async ({ groupId = '' } = {}) => {
  const hasSendable = Object.values(getState().reservations || {}).some(reservation =>
    reservation && reservation.status === 'ready_to_send' &&
    (!groupId || reservation.group_id === String(groupId))
  )
  if (!hasSendable) return []
  return mutateState(state => {
    const claimed = []
    for (const reservation of Object.values(reservationList(state))) {
      if (!reservation || reservation.status !== 'ready_to_send') continue
      if (groupId && reservation.group_id !== String(groupId)) continue
      reservation.status = 'sending'
      reservation.sending_at = nowIso()
      claimed.push(view(reservation))
    }
    return claimed
  })
}

export const markReservationSent = async (reservationId, messageId = '') => mutateState(state => {
  const reservation = reservationList(state)[String(reservationId)]
  if (!reservation) return false
  reservation.status = 'completed'
  reservation.message_id = String(messageId || '')
  reservation.completed_at = nowIso()
  return true
})

export const markReservationSendFailed = async (reservationId, error = '') => mutateState(state => {
  const reservation = reservationList(state)[String(reservationId)]
  if (!reservation) return false
  reservation.delivery_attempts = Math.max(0, Math.trunc(Number(reservation.delivery_attempts) || 0)) + 1
  reservation.last_error = String(error || '').slice(0, 400)
  if (reservation.delivery_attempts < 3) {
    reservation.status = 'ready_to_send'
  } else {
    reservation.status = 'failed'
  }
  return reservation.status
})

export const resetStaleReservations = async () => {
  const now = Date.now()
  const hasStale = Object.values(getState().reservations || {}).some(reservation =>
    reservation?.status === 'processing' &&
    now - (Date.parse(reservation.processing_at || '') || 0) > 2 * 60 * 1000
  )
  if (!hasStale) return 0
  return mutateState(state => {
    let changed = 0
    for (const reservation of Object.values(reservationList(state))) {
      if (!reservation) continue
      if (reservation.status === 'processing') {
        const at = Date.parse(reservation.processing_at || '') || 0
        if (now - at > 2 * 60 * 1000) {
          reservation.status = 'ready'
          changed++
        }
      }
    }
    return changed
  })
}

// ---------------- 文案与结果 ----------------

const participantNames = reservation => {
  const names = (reservation.participants || []).map(item => String(item.display_name || item.user_id || '')).filter(Boolean)
  return names.length ? names : [String(reservation.owner_name || reservation.owner_id || '神秘人')]
}

export const participantsLabel = reservation => {
  const names = participantNames(reservation)
  const wrapped = names.map(name => `【${name}】`)
  if (wrapped.length === 1) return wrapped[0]
  if (wrapped.length === 2) return `${wrapped[0]}和${wrapped[1]}`
  if (wrapped.length === 3) return `${wrapped[0]}、${wrapped[1]}和${wrapped[2]}`
  return `【${names[0]}】等 ${names.length} 人`
}

const operatorLabel = reservation => {
  if (reservation.force_operator_id) {
    return String(reservation.force_operator_name || reservation.force_operator_id)
  }
  const names = participantNames(reservation)
  if (names.length <= 3) return names.join('、')
  return `${names[0]} 等 ${names.length} 人`
}

const multiOriginsLabel = victimPigs => {
  const total = victimPigs.length
  const unique = []
  for (const pig of victimPigs) {
    const name = String(pig?.name || '未知小猪').trim() || '未知小猪'
    if (!unique.includes(name)) unique.push(name)
  }
  if (unique.length === 1) return `${total} 只【${unique[0]}】`
  if (total === 2 && unique.length === 2) return `【${unique[0]}】和【${unique[1]}】`
  if (total === 3 && unique.length === 3) return `【${unique[0]}】、【${unique[1]}】和【${unique[2]}】`
  return `${unique.slice(0, 3).map(name => `【${name}】`).join('、')}等 ${total} 只小猪`
}

const specialTargetOutcome = (reservation, targetPig) => {
  const values = {
    participants: participantsLabel(reservation),
    target: reservation.target_name || reservation.target_id,
    pig: targetPig?.name || '未知小猪'
  }
  let pool
  let reason = ''
  if (isHumanPig(targetPig)) {
    pool = texts.RESERVED_TARGET_HUMAN_TEXTS
    reason = 'human'
  } else if (isFoodPig(targetPig)) {
    pool = texts.RESERVED_TARGET_FOOD_TEXTS
    reason = 'food'
  } else if (isEatenPig(targetPig)) {
    pool = texts.RESERVED_TARGET_EATEN_TEXTS
    reason = 'eaten'
  } else if (isSoldPig(targetPig)) {
    pool = texts.RESERVED_TARGET_SOLD_TEXTS
    reason = 'sold'
  } else {
    return null
  }
  return {
    type: 'reserved_special',
    renderData: null,
    plainText: formatText(pickText(pool), values),
    extraText: '',
    foodName: '',
    specialReason: reason,
    backfireVictimId: '',
    backfireVictimIds: [],
    backfireVictimNames: []
  }
}

/** 预约结果只判定一次；调用方负责立即 finalize 持久化 */
export const buildReservationOutcome = async (reservation, officialPigs) => {
  const targetPig = getPigById(officialPigs, reservation.target_pig_id)
  if (!targetPig) throw new Error(`预约目标资源暂时缺失: pig_id=${reservation.target_pig_id}`)
  const special = specialTargetOutcome(reservation, targetPig)
  if (special) return special

  const values = {
    participants: participantsLabel(reservation),
    target: reservation.target_name || reservation.target_id,
    pig: targetPig.name || '未知小猪'
  }
  const operator = operatorLabel(reservation)
  const guaranteed = reservation.force_mode === 'super' ||
    (reservation.force_mode === 'normal' && !reservation.protection_required)
  const roll = guaranteed ? 1 : Math.floor(Math.random() * 100) + 1

  if (roll <= 60) {
    let prefix
    if (reservation.force_mode === 'super') {
      const others = (reservation.participants || []).filter(item =>
        String(item.user_id) !== String(reservation.force_operator_id)
      )
      if (reservation.force_operator_id && others.length) {
        prefix = formatText(texts.SUPER_FORCE_RESERVATION_TAKEOVER_SUCCESS_TEXT, {
          ...values,
          participants: participantsLabel({ ...reservation, participants: others }),
          operator
        })
      } else {
        prefix = formatText(texts.SUPER_FORCE_RESERVATION_SUCCESS_TEXT, { ...values, operator })
      }
    } else {
      const pool = reservation.protection_required
        ? texts.PROTECTED_ROAST_SUCCESS_TEXTS
        : texts.ROAST_RESERVATION_SUCCESS_TEXTS
      prefix = formatText(pickText(pool), { ...values, operator })
    }
    const outcome = await buildSuccessOutcome(targetPig, {
      officialPigs,
      attackerName: operator,
      targetName: reservation.target_name || reservation.target_id,
      extraText: prefix
    })
    return {
      ...outcome,
      backfireVictimId: '',
      backfireVictimIds: [],
      backfireVictimNames: []
    }
  }

  if (roll <= 90) {
    const pool = reservation.protection_required
      ? texts.PROTECTED_ROAST_ESCAPE_TEXTS
      : texts.ROAST_RESERVATION_ESCAPE_TEXTS
    return {
      type: 'escape',
      renderData: null,
      plainText: formatText(pickText(pool), { ...values, operator }),
      extraText: '',
      foodName: '',
      specialReason: '',
      backfireVictimId: '',
      backfireVictimIds: [],
      backfireVictimNames: []
    }
  }

  const participants = reservation.participants || []
  const count = Math.max(1, Math.floor(Math.random() * participants.length) + 1)
  const shuffled = [...participants]
  for (let index = shuffled.length - 1; index > 0; index--) {
    const pick = Math.floor(Math.random() * (index + 1))
    ;[shuffled[index], shuffled[pick]] = [shuffled[pick], shuffled[index]]
  }
  const victims = shuffled.slice(0, Math.min(count, participants.length))
  const victimPigs = victims.map(item => {
    const pig = getPigById(officialPigs, item.pig_id)
    if (!pig) throw new Error(`预约参与者资源暂时缺失: user_id=${item.user_id} pig_id=${item.pig_id}`)
    return pig
  })
  let representative = victims[0]
  let representativePig = victimPigs[0]
  if (victims.length > 1) {
    const roastableIndex = victimPigs.findIndex(pig => canBackfireRoast(pig))
    if (roastableIndex >= 0) {
      representative = victims[roastableIndex]
      representativePig = victimPigs[roastableIndex]
    }
  }
  const names = victims.map(item => String(item.display_name || item.user_id))
  const victimIds = victims.map(item => String(item.user_id))

  if (victims.length > 1) {
    const roastablePigs = victimPigs.filter(pig => canBackfireRoast(pig))
    const food = roastablePigs.length ? pickFoodPig(officialPigs) : null
    const pool = food
      ? texts.ROAST_RESERVATION_MULTI_BACKFIRE_TEXTS
      : texts.ROAST_RESERVATION_MULTI_BACKFIRE_NO_FOOD_TEXTS
    const summary = formatText(pickText(pool), {
      ...values,
      count: victims.length,
      victims: names.join('、')
    })
    if (!food) {
      return {
        type: 'backfire',
        renderData: null,
        plainText: summary,
        extraText: '',
        foodName: '',
        specialReason: '',
        backfireVictimId: victimIds[0],
        backfireVictimIds: victimIds,
        backfireVictimNames: names
      }
    }
    const renderData = { ...food, description: pickText(texts.ROAST_RESERVATION_MULTI_BACKFIRE_SUBTITLES) }
    renderData.analysis = roastablePigs.length === 1
      ? formatText(pickText(texts.ROAST_RESERVATION_SINGLE_ROASTABLE_BACKFIRE_CARD_TEXTS), {
          origin: roastablePigs[0].name || '未知小猪',
          food: food.name || '熟食'
        })
      : formatText(pickText(texts.ROAST_RESERVATION_MULTI_BACKFIRE_CARD_TEXTS), {
          origins: multiOriginsLabel(roastablePigs),
          count: roastablePigs.length,
          food: food.name || '熟食'
        })
    return {
      type: 'backfire',
      renderData,
      plainText: '',
      extraText: summary,
      foodName: food.name || '',
      specialReason: '',
      backfireVictimId: victimIds[0],
      backfireVictimIds: victimIds,
      backfireVictimNames: names
    }
  }

  const pool = reservation.protection_required
    ? texts.PROTECTED_ROAST_BACKFIRE_TEXTS
    : texts.ROAST_RESERVATION_BACKFIRE_TEXTS
  const prefix = formatText(pickText(pool), {
    ...values,
    victim: representative.display_name || representative.user_id
  })
  const outcome = await buildBackfireOutcome(representativePig, {
    officialPigs,
    attackerName: representative.display_name || representative.user_id,
    targetName: reservation.target_name || reservation.target_id,
    extraText: prefix
  })
  return {
    ...outcome,
    backfireVictimId: victimIds[0],
    backfireVictimIds: victimIds,
    backfireVictimNames: names
  }
}

const applyFeedInState = (state, { date, userId, sourceId }) => {
  const uid = String(userId)
  const pigId = String(state.history?.[date]?.[uid] || '')
  if (!pigId) return { status: 'no_daily_pig', userId: uid }
  state.daily_feeds ||= {}
  state.daily_feeds[date] ||= {}
  const existing = state.daily_feeds[date][uid]
  if (existing && typeof existing === 'object') {
    return {
      status: existing.source_id === sourceId ? 'fed' : 'already_fed',
      userId: uid,
      pigId: existing.pig_id || pigId,
      previousLevel: existing.previous_level || 0,
      newLevel: existing.new_level || 0
    }
  }
  state.pig_progress[uid] ||= {}
  const progress = state.pig_progress[uid][pigId]
  if (!progress || typeof progress !== 'object') return { status: 'no_daily_pig', userId: uid }
  const copies = Math.max(1, Math.trunc(Number(progress.copies) || 1))
  const bonus = Math.max(0, Math.trunc(Number(progress.growth_bonus) || 0))
  const previousLevel = expertLevel(copies, bonus)
  if (previousLevel >= FEED_MAX_LEVEL) return { status: 'max_level', userId: uid, pigId, previousLevel, newLevel: previousLevel }
  progress.growth_bonus = bonus + 1
  const newLevel = expertLevel(copies, bonus + 1)
  const result = {
    status: 'fed',
    userId: uid,
    pigId,
    previousLevel,
    newLevel,
    source_type: 'reservation',
    source_id: String(sourceId),
    created_at: nowIso()
  }
  state.daily_feeds[date][uid] = {
    status: 'fed',
    pig_id: pigId,
    previous_level: previousLevel,
    new_level: newLevel,
    source_type: 'reservation',
    source_id: String(sourceId),
    created_at: result.created_at
  }
  return result
}

/** 把 AI 文案之外的所有结算（加餐、破防升级、事件）与结果快照一次性落盘 */
export const finalizeReservation = async ({ reservationId, outcome }) => mutateState(state => {
  const reservation = reservationList(state)[String(reservationId)]
  if (!reservation) return null
  if (reservation.outcome_snapshot) {
    return {
      reservation: view(reservation),
      outcome: reservation.outcome_snapshot,
      event: (state.events?.[reservation.date_str] || []).find(item => item.reservation_id === reservation.reservation_id) || null,
      feedResults: reservation.feed_results || [],
      protectionUpgrade: reservation.protection_upgrade || null,
      already: true
    }
  }

  const date = reservation.date_str
  const feedResults = []
  if (outcome.type === 'success') {
    let eligible = []
    if (reservation.force_mode === 'super') {
      eligible = [...(reservation.force_feed_user_ids || [])]
    } else if (reservation.force_mode === '' || reservation.protection_required) {
      eligible = (reservation.participants || [])
        .filter(item => Math.trunc(Number(item.contribution) || 1) === 1)
        .map(item => String(item.user_id))
    }
    for (const uid of [...new Set(eligible)]) {
      feedResults.push(applyFeedInState(state, { date, userId: uid, sourceId: reservation.reservation_id }))
    }
  }

  let protectionUpgrade = null
  if (outcome.type === 'success' && reservation.protection_required) {
    const groupId = reservation.group_id
    const targetId = reservation.target_id
    const detail = state.protection_details?.[date]?.[groupId]?.[targetId] || {
      base_level: reservation.protection_level || 3,
      consecutive_days: 1,
      success_offset: 0,
      source: 'daily'
    }
    const baseLevel = Math.min(5, Math.max(1, Math.trunc(Number(detail.base_level) || 1)))
    const offset = Math.max(0, Math.trunc(Number(detail.success_offset) || 0))
    const before = Math.min(5, baseLevel + offset)
    const after = Math.min(5, before + 1)
    detail.base_level = baseLevel
    detail.success_offset = Math.max(0, offset + (after > before ? 1 : 0))
    detail.consecutive_days = Math.max(1, Math.trunc(Number(detail.consecutive_days) || 1))
    detail.source = 'daily'
    state.protection_details[date] ||= {}
    state.protection_details[date][groupId] ||= {}
    state.protection_details[date][groupId][targetId] = detail
    protectionUpgrade = { changed: after > before, before, level: after }

    const newRequired = protectionRequired(after)
    for (const pending of Object.values(reservationList(state))) {
      if (!pending || pending.status !== 'pending' ||
        pending.date_str !== date || pending.group_id !== groupId || pending.target_id !== targetId) continue
      if (pending.force_mode === 'super') continue
      if (!pending.protection_required && pending.force_mode === 'normal' && pending.participants?.length) {
        pending.participants[0].contribution = 2
      }
      pending.protection_required = newRequired
      pending.protection_level = after
      refreshReady(pending)
    }
  }

  reservation.outcome_snapshot = outcome
  reservation.feed_results = feedResults
  reservation.protection_upgrade = protectionUpgrade
  reservation.status = 'ready_to_send'
  reservation.prepared_at = nowIso()

  const event = buildEventRecord({
    date,
    type: outcome.type,
    attacker: reservation.force_operator_id || reservation.owner_id,
    target: reservation.target_id,
    attacker_name: reservation.force_operator_name || reservation.owner_name,
    target_name: reservation.target_name,
    food: outcome.foodName || '',
    group_id: reservation.group_id,
    reservation_id: reservation.reservation_id,
    participant_ids: (reservation.participants || []).map(item => item.user_id),
    participant_names: (reservation.participants || []).map(item => item.display_name),
    participant_count: (reservation.participants || []).length,
    backfire_victim_id: outcome.backfireVictimId || '',
    backfire_victim_ids: outcome.backfireVictimIds || [],
    backfire_victim_names: outcome.backfireVictimNames || [],
    special_reason: outcome.specialReason || '',
    force_mode: reservation.force_mode || '',
    protection_level: reservation.protection_required ? Math.max(0, reservation.protection_required - 1) : 0,
    reservation_owner_id: reservation.owner_id || '',
    reservation_owner_name: reservation.owner_name || ''
  })
  state.events ||= {}
  state.events[date] ||= []
  const existingEvent = state.events[date].find(item => item.reservation_id === reservation.reservation_id)
  if (!existingEvent) state.events[date].push(event)

  return {
    reservation: view(reservation),
    outcome: reservation.outcome_snapshot,
    event: existingEvent || event,
    feedResults,
    protectionUpgrade
  }
})

export const reservationView = view
export const reservationMaxParticipants = MAX_PARTICIPANTS
export const formatReservationCooldown = formatCooldown

/** 通知文案：把 preparation 状态映射成用户可读文本 */
export const pickReservationNoticeText = (preparation, { attackerName, targetName }) => {
  if (!preparation) return ''
  const reservation = preparation.reservation
  const status = preparation.status
  if (status === 'reservation_busy') return pickText(texts.PROTECTED_ROAST_BUSY_TEXTS)
  if (status === 'reservation_full') {
    if (reservation?.protection_required) {
      return formatText(pickText(texts.PROTECTED_ROAST_FULL_TEXTS), {
        target: targetName,
        count: reservation.participant_count
      })
    }
    return formatText(pickText(texts.ROAST_RESERVATION_FULL_TEXTS), {
      target: targetName,
      count: reservation?.participant_count || 0
    })
  }
  if (reservation?.force_mode === 'super') {
    if (status === 'reservation_closed') {
      return formatText(texts.SUPER_FORCE_RESERVATION_CLOSED_TEXT, {
        operator: reservation.force_operator_name || reservation.owner_name || attackerName,
        target: targetName
      })
    }
    if (reservation.status !== 'pending') return ''
    if (status === 'already_joined') {
      return formatText(texts.SUPER_FORCE_RESERVATION_DUPLICATE_TEXT, { target: targetName })
    }
    if (status === 'reservation_created') {
      return formatText(texts.SUPER_FORCE_RESERVATION_CREATED_TEXT, { operator: attackerName, target: targetName })
    }
    if (status === 'reservation_joined') {
      return formatText(texts.SUPER_FORCE_RESERVATION_TAKEOVER_TEXT, { operator: attackerName, target: targetName })
    }
  }
  if (reservation?.protection_required && reservation.force_mode !== 'super' &&
    ['reservation_created', 'reservation_joined', 'reservation_upgraded', 'already_joined'].includes(status)) {
    if (reservation.status !== 'pending') return ''
    const waitingForPig = !reservation.target_pig_id && reservation.contribution_count >= reservation.protection_required
    const progressPool = waitingForPig ? texts.PROTECTED_ROAST_READY_PROGRESS_TEXTS : texts.PROTECTED_ROAST_PROGRESS_TEXTS
    const progress = formatText(pickText(progressPool), {
      level: Math.max(1, reservation.protection_required - 1),
      current: reservation.contribution_count,
      required: reservation.protection_required
    })
    if (status === 'already_joined') {
      return `${formatText(pickText(texts.PROTECTED_ROAST_DUPLICATE_TEXTS), { target: targetName })}\n${progress}`
    }
    const last = reservation.participants?.[reservation.participants.length - 1]
    const isBoosted = Math.trunc(Number(last?.contribution) || 1) === 2
    if (status === 'reservation_created') {
      const opening = formatText(pickText(texts.PROTECTION_BLOCK_TEXTS), { target: targetName })
      const createPool = isBoosted ? texts.PROTECTED_ROAST_BOOST_CREATED_TEXTS : texts.PROTECTED_ROAST_CREATED_TEXTS
      const action = formatText(pickText(createPool), { owner: attackerName, target: targetName })
      return [opening, action, progress].join('\n')
    }
    if (status === 'reservation_upgraded') {
      return [
        formatText(pickText(texts.PROTECTED_ROAST_BOOST_TEXTS), { participant: attackerName, target: targetName }),
        progress
      ].join('\n')
    }
    const joinPool = isBoosted ? texts.PROTECTED_ROAST_BOOST_JOINED_TEXTS : texts.PROTECTED_ROAST_JOINED_TEXTS
    return [
      formatText(pickText(joinPool), { participant: attackerName, target: targetName }),
      progress
    ].join('\n')
  }
  if (status === 'reservation_closed') return '这场预约已经结束或过期，不能再加入了。'
  if (status === 'attacker_unrolled') return '先发送「今日小猪」领一只猪，再来加入预约。'
  if (status === 'self_target') return '这场预约烤的就是你，别往自己的烤架里添柴了。'
  if (status === 'reservation_created') {
    return formatText(pickText(texts.ROAST_RESERVATION_CREATED_TEXTS), { owner: attackerName, target: targetName })
  }
  if (status === 'reservation_joined') {
    return formatText(pickText(texts.ROAST_RESERVATION_JOINED_TEXTS), {
      participant: attackerName,
      target: targetName,
      count: reservation?.participant_count || 0
    })
  }
  if (status === 'already_joined') {
    return formatText(pickText(texts.ROAST_RESERVATION_DUPLICATE_TEXTS), {
      target: targetName,
      count: reservation?.participant_count || 0
    })
  }
  return '预约烤猪暂时没有响应，请稍后再试。'
}

export const feedTextForResults = feedResults => {
  const fed = (feedResults || []).filter(item => item.status === 'fed' && item.newLevel > item.previousLevel)
  if (!fed.length) return ''
  const names = fed.map(item => String(item.displayName || item.userId || ''))
  const label = names.length <= 3
    ? names.map(name => `【${name}】`).join('、')
    : `【${names[0]}】等 ${names.length} 人`
  return formatText(pickText(texts.DAILY_FEED_RESERVATION_TEXTS), { participants: label })
}

export const feedResultsWithNames = (feedResults, reservation) => (feedResults || []).map(item => {
  const user = (reservation?.participants || []).find(p => String(p.user_id) === String(item.userId))
  return { ...item, displayName: user?.display_name || item.userId }
})
