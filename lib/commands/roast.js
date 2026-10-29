// 今日烤猪 / 烤群友 / 随机烤群友 / 回复加入预约 / 烤箱续火。
import { segment } from 'oicq'
import { pathToFileURL } from 'url'
import { getState, mutateState } from '../state.js'
import { todayStr } from '../time.js'
import {
  findPigImageAny,
  getPigById,
  pickFoodPig
} from '../pigs.js'
import { formatText, pickText, texts } from '../texts.js'
import { getHistoryPigId, recordGroupRoll } from '../daily.js'
import { appendRoastEvent } from '../roast/events.js'
import {
  buildMemberRoastOutcome,
  buildSelfRoastData,
  detectForceMode,
  pickForceLimitText,
  pickMemberTargetBlock,
  pickRandomTargetBlock,
  pickSelfRoastBlock
} from '../roast/flow.js'
import {
  consumeForceUsage,
  consumeRoastCharge,
  formatCooldown
} from '../roast/charges.js'
import {
  joinReservationByMessage,
  pickReservationNoticeText,
  prepareRoastReservation
} from '../roast/reservations.js'
import { deliverReadyReservations, deliverWaitingNotices } from '../roast/delivery.js'
import { applyDailyFeed, feedTextForResultWithPigName } from '../roast/feed.js'
import { protectionLevel } from '../roast/protection.js'
import {
  REFILL_IMAGE_PATH,
  bindRefillMessage,
  completeRefillIfReady,
  createRefillRequest,
  findRefillByMessage,
  formatRefillCreated,
  formatRefillExisting,
  formatRefillSuccess,
  refillInactiveText,
  refillInsufficientText,
  voteRefill
} from '../roast/refill.js'
import {
  botIds,
  groupContext,
  groupMemberRole,
  imageSegment,
  isGroupMember,
  isMaster,
  messageIdOf,
  resolveTarget,
  roleWeight,
  touchContext,
  userName
} from './helpers.js'

const MISSING = '你的今日小猪已经抽出来了，但当前 Bot 的小猪资源暂时缺失，请稍后再试。'
const log = () => globalThis.logger || console

const appendEvent = event => appendRoastEvent(event)

const markTargetSeen = async (date, groupId, targetId, targetPigId) => {
  if (!groupId || !targetPigId) return
  await mutateState(state => recordGroupRoll(state, date, groupId, targetId, targetPigId))
}

const buildOutcomeMessage = outcome => {
  const parts = []
  if (outcome.extraText) parts.push(String(outcome.extraText).replace(/\s+$/, ''))
  if (outcome.renderData) {
    const imagePath = findPigImageAny(outcome.renderData.id)
    if (imagePath) parts.push(segment.image(pathToFileURL(imagePath).href))
    parts.push(`【${outcome.renderData.name || '熟食'}】\n${outcome.renderData.description || ''}\n\n${outcome.renderData.analysis || ''}`)
  } else if (outcome.plainText) {
    parts.push(String(outcome.plainText))
  }
  return parts.filter(Boolean)
}

const finishOutcome = async (plugin, e, {
  outcome,
  attackerId,
  attackerName,
  targetId,
  targetName,
  groupId,
  forceMode = null,
  dailyFeedEligible = false,
  reservation = null
}) => {
  const date = todayStr()
  const message = buildOutcomeMessage(outcome)
  if (outcome.type === 'success' && dailyFeedEligible && forceMode === null) {
    const feed = await applyDailyFeed({
      userId: attackerId,
      date,
      sourceType: 'roast',
      sourceId: `${date}:${attackerId}:${Date.now()}`
    })
    if (feed.status === 'fed') {
      const attackerPig = getPigById(plugin.pigData, getHistoryPigId(date, attackerId))
      const feedText = feedTextForResultWithPigName(feed, attackerPig?.name)
      if (feedText) message.push(feedText)
    }
  }
  const protection = targetId ? protectionLevel(date, groupId, targetId) : 0
  await appendEvent({
    date,
    type: outcome.type,
    attacker: attackerId,
    target: targetId,
    attacker_name: attackerName,
    target_name: targetName,
    food: outcome.foodName || '',
    group_id: groupId,
    reservation_id: reservation?.reservation_id || '',
    participant_ids: reservation?.participant_ids || [],
    participant_names: reservation?.participant_names || [],
    participant_count: reservation?.participant_count || 0,
    backfire_victim_id: outcome.backfireVictimId || '',
    backfire_victim_ids: outcome.backfireVictimIds || [],
    backfire_victim_names: outcome.backfireVictimNames || [],
    special_reason: outcome.specialReason || '',
    force_mode: forceMode || '',
    protection_level: protection
  })
  await e.reply(message)
  await markTargetSeen(date, groupId, targetId, getHistoryPigId(date, targetId))
}

const recordUnrolledAttempt = async (plugin, e, { attackerId, attackerName, groupId, forceMode }) => {
  const date = todayStr()
  const attempt = await mutateState(state => {
    state.unrolled_attempts ||= {}
    state.unrolled_attempts[date] ||= {}
    // plus 的违规次数按“用户/天”全局累计；保护统计才按群/天/人限一次。
    const count = Math.max(0, Math.trunc(Number(state.unrolled_attempts[date][attackerId]) || 0)) + 1
    state.unrolled_attempts[date][attackerId] = count
    return count
  })
  if (attempt <= 1) {
    await e.reply(pickText(texts.UNROLLED_ROAST_WARNING_TEXTS))
    return true
  }
  try {
    const foodPig = pickFoodPig(plugin.pigData)
    const pool = forceMode ? texts.UNROLLED_FORCE_ROAST_BACKFIRE_TEXTS : texts.UNROLLED_ROAST_BACKFIRE_TEXTS
    const text = formatText(pickText(pool), { attacker: attackerName, food: foodPig.name || '熟食' })
    await appendEvent({
      date,
      type: 'backfire',
      attacker: attackerId,
      target: attackerId,
      attacker_name: attackerName,
      target_name: attackerName,
      food: foodPig.name || '',
      group_id: groupId,
      special_reason: 'unrolled',
      force_mode: forceMode || ''
    })
    await e.reply([
      imageSegment(findPigImageAny(foodPig.id)),
      `【${foodPig.name}】\n${text}`
    ])
  } catch (error) {
    await e.reply(error?.message || '熟食规则缺失，请检查 pig_rules.json。')
  }
  return true
}

const handlerTargetReady = async (plugin, e, {
  attackerId,
  attackerName,
  attackerPig,
  targetId,
  targetName,
  groupId,
  forceMode
}) => {
  const date = todayStr()
  if (forceMode === 'normal') {
    if (!await consumeForceUsage(attackerId, date)) {
      await e.reply(pickForceLimitText(attackerName, targetName))
      return
    }
  } else if (forceMode !== 'super') {
    const cooldown = await consumeRoastCharge(attackerId, { config: plugin.config })
    if (!cooldown.allowed) {
      await e.reply(formatCooldown(cooldown.remaining_seconds))
      return
    }
  }
  const targetPig = getPigById(plugin.pigData, getHistoryPigId(date, targetId))
  if (!targetPig) {
    await e.reply('目标的小猪资源缺失，暂时无法开火。')
    return
  }
  const block = pickMemberTargetBlock(targetName, targetPig)
  if (block) {
    await e.reply(block)
    return
  }
  try {
    const outcome = await buildMemberRoastOutcome({
      attackerPig,
      targetPig,
      attackerName,
      targetName,
      forceMode,
      officialPigs: plugin.pigData
    })
    await finishOutcome(plugin, e, {
      outcome,
      attackerId,
      attackerName,
      targetId,
      targetName,
      groupId,
      forceMode,
      dailyFeedEligible: forceMode === null
    })
  } catch (error) {
    await e.reply(error?.message || '烤猪结算失败，请检查 pig_rules.json。')
  }
}

const handleReservationPreparation = async (plugin, e, {
  preparation,
  attackerName,
  targetName,
  groupId,
  forceMode
}) => {
  const status = preparation.status
  if (status === 'target_ready') return false
  if (status === 'cooldown_denied') {
    await e.reply(formatCooldown(preparation.cooldown?.remaining_seconds))
    return true
  }
  if (status === 'force_denied') {
    await e.reply(pickForceLimitText(attackerName, targetName))
    return true
  }
  if (status === 'reservation_busy') {
    await e.reply(pickText(texts.PROTECTED_ROAST_BUSY_TEXTS))
    return true
  }
  const reservation = preparation.reservation
  if (!reservation) return true
  const protectedTarget = protectionLevel(todayStr(), groupId, reservation.target_id) > 0
  const breakText = forceMode === 'super' && protectedTarget
    ? formatText(pickText(texts.PROTECTION_BREAK_TEXTS), { target: targetName })
    : ''
  if (reservation.status === 'ready') {
    if (breakText) await e.reply(breakText)
    await deliverReadyReservations({ groupId })
    await deliverWaitingNotices({ groupId })
    return true
  }
  const notice = pickReservationNoticeText(preparation, { attackerName, targetName })
  const text = [breakText, notice].filter(Boolean).join('\n')
  if (!text) return true
  const result = await e.reply(text)
  const messageId = messageIdOf(result)
  if (messageId) await bindRefillMessageSafe(reservation.reservation_id, messageId, e.self_id)
  return true
}

const bindRefillMessageSafe = async (reservationId, messageId, botId) => {
  // 预约通知和续火投票都用消息 ID 关联；这里复用 reservations 的绑定函数。
  const { bindReservationMessage } = await import('../roast/reservations.js')
  await bindReservationMessage(reservationId, messageId, botId)
}

export const todayRoast = async (plugin, e) => {
  const userId = String(e.user_id)
  const { groupId } = groupContext(e)
  const attackerName = userName(e)
  await touchContext(e, userId, attackerName)
  const date = todayStr()
  let pigId = getHistoryPigId(date, userId)
  let autoCreated = false
  if (!pigId) {
    try {
      const { getOrCreateDailyRoll } = await import('../daily.js')
      const result = await getOrCreateDailyRoll({ userId, officialPigs: plugin.pigData, date, groupId })
      pigId = result.pig_id
      autoCreated = result.created
    } catch (error) {
      await e.reply(error?.message || '猪圈塌房了（数据缺失）')
      return true
    }
  }
  const originalPig = getPigById(plugin.pigData, pigId)
  if (!originalPig) {
    await e.reply(MISSING)
    return true
  }
  const autoText = autoCreated
    ? formatText(pickText(texts.AUTO_ROLL_ROAST_TEXTS), { name: originalPig.name }) + '\n'
    : ''
  const block = pickSelfRoastBlock(originalPig)
  if (block) {
    await e.reply(autoText + block)
    if (autoCreated) {
      const { activateReservationsForTarget } = await import('../roast/reservations.js')
      await activateReservationsForTarget({ targetId: userId, targetPigId: pigId, date })
      await deliverReadyReservations({})
    }
    return true
  }
  try {
    const { renderData, foodName } = await buildSelfRoastData(originalPig, plugin.pigData)
    if (groupId) {
      await appendEvent({
        date,
        type: 'self_roast',
        attacker: userId,
        target: userId,
        attacker_name: attackerName,
        target_name: attackerName,
        food: foodName,
        group_id: groupId
      })
    }
    const message = buildOutcomeMessage({
      type: 'self_roast',
      renderData,
      plainText: '',
      extraText: autoText,
      foodName
    })
    await e.reply(message)
    if (autoCreated) {
      const { activateReservationsForTarget } = await import('../roast/reservations.js')
      await activateReservationsForTarget({ targetId: userId, targetPigId: pigId, date })
      await deliverReadyReservations({})
      await deliverWaitingNotices({})
    }
  } catch (error) {
    await e.reply(error?.message || '熟食规则缺失，请检查 pig_rules.json。')
  }
  return true
}

const attackerContext = (plugin, e, { attackerId, attackerName, groupId, forceMode }) => {
  const date = todayStr()
  const pigId = getHistoryPigId(date, attackerId)
  if (!pigId) return { unrolled: true }
  const pig = getPigById(plugin.pigData, pigId)
  if (!pig) return { missing: true }
  return { date, pigId, pig }
}

export const memberRoast = async (plugin, e) => {
  const { groupId } = groupContext(e)
  if (!groupId) {
    await e.reply('请在群里烤群友。')
    return true
  }
  const attackerId = String(e.user_id)
  const attackerName = userName(e)
  await touchContext(e, attackerId, attackerName)
  const forceMode = detectForceMode(e.msg, isMaster(e))
  if (forceMode === 'super_denied') {
    await e.reply('口令【强行点火】仅 Bot 主人可用。')
    return true
  }
  const target = await resolveTarget(e)
  if (target.error) {
    await e.reply(target.error)
    return true
  }
  if (target.targetId === attackerId) {
    await e.reply('对自己好一点，别自焚。请发送「今日烤猪」。')
    return true
  }
  if (target.isBot) {
    let foodName = '美食'
    try {
      foodName = pickFoodPig(plugin.pigData).name
    } catch {}
    const text = formatText(pickText(texts.ROAST_BOT_TEXTS), { attacker: attackerName, food: foodName })
    await appendEvent({
      date: todayStr(),
      type: 'bot_backfire',
      attacker: attackerId,
      target: String(e.self_id),
      attacker_name: attackerName,
      target_name: 'Bot',
      food: foodName,
      group_id: groupId
    })
    await e.reply(text)
    return true
  }
  if (!isGroupMember(e, target.targetId)) {
    await e.reply('暂时无法确认对方仍在本群，请核对成员后再试。')
    return true
  }
  const attacker = attackerContext(plugin, e, { attackerId, attackerName, groupId, forceMode })
  if (attacker.unrolled || attacker.missing) {
    if (attacker.missing) {
      await e.reply(MISSING)
      return true
    }
    await recordUnrolledAttempt(plugin, e, { attackerId, attackerName, groupId, forceMode })
    return true
  }
  await markTargetSeen(attacker.date, groupId, attackerId, attacker.pigId)
  const knownTargetPigId = getHistoryPigId(attacker.date, target.targetId)
  const knownTargetPig = knownTargetPigId ? getPigById(plugin.pigData, knownTargetPigId) : null
  if (knownTargetPig) {
    const block = pickMemberTargetBlock(target.targetId === String(e.self_id) ? 'Bot' : userName(e, target.targetId), knownTargetPig)
    if (block) {
      await e.reply(block)
      return true
    }
  }
  let preparation
  try {
    preparation = await prepareRoastReservation({
      attackerId,
      attackerName,
      attackerPigId: attacker.pigId,
      targetId: target.targetId,
      targetName: userName(e, target.targetId),
      groupId,
      forceMode,
      config: plugin.config
    })
  } catch (error) {
    await e.reply(error?.message || '烤猪预约失败，请稍后再试。')
    return true
  }
  if (preparation.status === 'target_ready') {
    await handlerTargetReady(plugin, e, {
      attackerId,
      attackerName,
      attackerPig: attacker.pig,
      targetId: target.targetId,
      targetName: userName(e, target.targetId),
      groupId,
      forceMode
    })
    return true
  }
  await handleReservationPreparation(plugin, e, {
    preparation,
    attackerName,
    targetName: userName(e, target.targetId),
    groupId,
    forceMode
  })
  return true
}

export const randomRoast = async (plugin, e) => {
  const { groupId } = groupContext(e)
  if (!groupId) {
    await e.reply('请在群里随机烤群友。')
    return true
  }
  const attackerId = String(e.user_id)
  const attackerName = userName(e)
  await touchContext(e, attackerId, attackerName)
  const date = todayStr()
  const rolls = getState().group_rolls?.[date]?.[groupId] || {}
  const candidates = Object.keys(rolls).filter(uid =>
    uid !== attackerId && uid !== String(e.self_id) && isGroupMember(e, uid)
  )
  if (!candidates.length) {
    await e.reply('今天还没有别人抽猪，没有可以烤的目标！')
    return true
  }
  const attacker = attackerContext(plugin, e, { attackerId, attackerName, groupId, forceMode: null })
  if (attacker.unrolled || attacker.missing) {
    if (attacker.missing) {
      await e.reply(MISSING)
      return true
    }
    await recordUnrolledAttempt(plugin, e, { attackerId, attackerName, groupId, forceMode: null })
    return true
  }
  await markTargetSeen(date, groupId, attackerId, attacker.pigId)
  const targetId = candidates[Math.floor(Math.random() * candidates.length)]
  const targetName = userName(e, targetId)
  const targetPigId = rolls[targetId]?.pig_id || getHistoryPigId(date, targetId)
  const targetPig = getPigById(plugin.pigData, targetPigId)
  if (!targetPig) {
    await e.reply(`系统随机选中了【${targetName}】，但对方的猪数据异常。`)
    return true
  }
  await markTargetSeen(date, groupId, targetId, targetPig.id)
  const block = pickRandomTargetBlock(targetName, targetPig)
  if (block) {
    await e.reply(block)
    return true
  }
  const protectedTarget = protectionLevel(date, groupId, targetId) > 0
  if (protectedTarget) {
    let preparation
    try {
      preparation = await prepareRoastReservation({
        attackerId,
        attackerName,
        attackerPigId: attacker.pigId,
        targetId,
        targetName,
        groupId,
        forceMode: null,
        config: plugin.config
      })
    } catch (error) {
      await e.reply(error?.message || '烤猪预约失败，请稍后再试。')
      return true
    }
    await handleReservationPreparation(plugin, e, {
      preparation,
      attackerName,
      targetName,
      groupId,
      forceMode: null
    })
    return true
  }
  const cooldown = await consumeRoastCharge(attackerId, { config: plugin.config })
  if (!cooldown.allowed) {
    await e.reply(formatCooldown(cooldown.remaining_seconds))
    return true
  }
  const intro = formatText(pickText(texts.RANDOM_ROAST_INTRO_TEXTS), { target: targetName }) + '\n'
  try {
    const outcome = await buildMemberRoastOutcome({
      attackerPig: attacker.pig,
      targetPig,
      attackerName,
      targetName,
      forceMode: null,
      introText: intro,
      officialPigs: plugin.pigData
    })
    await finishOutcome(plugin, e, {
      outcome,
      attackerId,
      attackerName,
      targetId,
      targetName,
      groupId,
      forceMode: null,
      dailyFeedEligible: true
    })
  } catch (error) {
    await e.reply(error?.message || '烤猪结算失败，请检查 pig_rules.json。')
  }
  return true
}

export const joinReservation = async (plugin, e) => {
  if (!e.reply_id) return false
  const { groupId } = groupContext(e)
  if (!groupId) return false
  const attackerId = String(e.user_id)
  const attackerName = userName(e)
  await touchContext(e, attackerId, attackerName)
  const result = await joinReservationByMessage({
    messageId: e.reply_id,
    groupId,
    attackerId,
    attackerName
  })
  if (result.status === 'message_not_found') return false
  if (result.status === 'attacker_unrolled') {
    await e.reply('先发送「今日小猪」领一只猪，再来加入预约。')
    return true
  }
  if (result.status === 'reservation_busy') {
    await e.reply(pickText(texts.PROTECTED_ROAST_BUSY_TEXTS))
    return true
  }
  const reservation = result.reservation
  if (result.status === 'force_denied') {
    await e.reply(pickForceLimitText(attackerName, reservation?.target_name || ''))
    return true
  }
  if (reservation?.status === 'ready') {
    await deliverReadyReservations({ groupId })
    await deliverWaitingNotices({ groupId })
    return true
  }
  const notice = pickReservationNoticeText(result, {
    attackerName,
    targetName: reservation?.target_name || ''
  })
  if (notice) await e.reply(notice)
  return true
}

const addReaction = async (e, messageId) => {
  try {
    const api = e.bot?.sendApi || e.bot?.sendAction
    if (typeof api === 'function') {
      await api.call(e.bot, 'set_msg_emoji_like', { message_id: messageId, emoji_id: '424', set: true })
      return true
    }
  } catch {}
  return false
}

export const refill = async (plugin, e) => {
  const { groupId } = groupContext(e)
  if (!groupId) {
    await e.reply('请在群里发送「烤箱续火」。')
    return true
  }
  const initiatorId = String(e.user_id)
  const initiatorName = userName(e)
  await touchContext(e, initiatorId, initiatorName)
  const created = await createRefillRequest({
    groupId,
    initiatorId,
    initiatorName,
    excludeIds: botIds(),
    config: plugin.config
  })
  if (created.status === 'insufficient_active') {
    await e.reply(refillInsufficientText())
    return true
  }
  if (created.status === 'inactive_initiator') {
    await e.reply(refillInactiveText())
    return true
  }
  if (created.status === 'existing') {
    const completed = await completeRefillIfReady(created.request.request_id)
    if (completed.status === 'succeeded') {
      await e.reply(formatRefillSuccess(completed))
    } else {
      await e.reply(formatRefillExisting(completed.request || created.request))
    }
    return true
  }
  const request = created.request
  const message = [
    imageSegment(REFILL_IMAGE_PATH),
    formatRefillCreated(request)
  ]
  const result = await e.reply(message)
  const messageId = messageIdOf(result)
  if (messageId) {
    await bindRefillMessage(request.request_id, messageId, e.self_id)
    await addReaction(e, messageId)
  }
  return true
}

export const voteRefillReply = async (plugin, e) => {
  if (!e.reply_id) return false
  const request = findRefillByMessage(e.reply_id, e.group_id)
  if (!request) return false
  const result = await voteRefill({
    requestId: request.request_id,
    userId: e.user_id,
    weight: roleWeight(e)
  })
  if (result.status === 'succeeded') {
    await e.reply(formatRefillSuccess(result))
  } else if (result.status === 'expired') {
    await e.reply('本轮续火投票已经结束。')
  } else if (result.status === 'not_eligible') {
    await e.reply('只有本群今日活跃玩家才能参与续火投票。')
  }
  return true
}

export const onReaction = async e => {
  const likes = Array.isArray(e.likes) ? e.likes : []
  if (!likes.some(item => String(item.emoji_id) === '424' && Number(item.count) > 0)) return false
  const request = findRefillByMessage(e.message_id, e.group_id)
  if (!request) return false
  const role = groupMemberRole(e.group_id, e.user_id)
  const result = await voteRefill({
    requestId: request.request_id,
    userId: e.user_id,
    weight: ['owner', 'admin'].includes(role) ? 2 : 1
  })
  if (result.status === 'succeeded') {
    try {
      await globalThis.Bot?.pickGroup?.(e.group_id)?.sendMsg(formatRefillSuccess(result))
    } catch (error) {
      log().warn?.('[烤箱续火] 成功消息发送失败:', error)
    }
  }
  return true
}
