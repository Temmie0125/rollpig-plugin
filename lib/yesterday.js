// 昨日回顾：事件归一化、足迹/高光/小结/余波与补签文案。
// 规则与 plus 的 yesterday_recap.py 对齐；卡片本身由 resource/yesterday.html 渲染。
import crypto from 'crypto'
import {
  expertLevel,
  getPigById,
  newlyUnlockedVariantLevels,
  resolveAppearance,
  variantFieldsForLevels
} from './pigs.js'
import { getState } from './state.js'
import { formatText, stablePick, texts } from './texts.js'
import { todayStr } from './time.js'
import { isProtected } from './roast/protection.js'
import { getDailySnapshot } from './daily.js'
import { queryEvents } from './roast/events.js'
import { listOfficialPigs } from './custom-store.js'

const familyForNormal = (eventType, attackerId, targetId, userId) => {
  if (eventType === 'self_roast' && attackerId === userId) return ['self_roast', 'self']
  if (eventType === 'success' && attackerId === userId) return ['success_as_attacker', 'attacker']
  if (eventType === 'success' && targetId === userId) return ['success_as_target', 'target']
  if (eventType === 'escape' && targetId === userId) return ['escape_as_target', 'target']
  if (eventType === 'escape' && attackerId === userId) return ['escape_as_attacker', 'attacker']
  if (eventType === 'backfire' && attackerId === userId) return ['normal_backfire', 'backfire_victim']
  if (eventType === 'bot_backfire' && attackerId === userId) return ['bot_backfire', 'backfire_victim']
  return ['', '']
}

const familyForReservation = ({ eventType, userId, attackerId, targetId, participantIds, backfireVictimId, specialReason }) => {
  if (eventType === 'backfire' && backfireVictimId === userId) return ['reservation_backfire_victim', 'backfire_victim']
  let role = ''
  if (targetId === userId) role = 'target'
  else if (attackerId === userId) role = 'owner'
  else if (participantIds.includes(userId)) role = 'participant'
  else return ['', '']
  if (eventType === 'success') {
    return [role === 'target' ? 'reservation_success_target' : 'reservation_success_participant', role]
  }
  if (eventType === 'escape') {
    return [role === 'target' ? 'reservation_escape_target' : 'reservation_escape_participant', role]
  }
  if (eventType === 'backfire') return ['reservation_backfire_participant', role]
  if (eventType === 'reserved_special') {
    if (role !== 'target') return ['reserved_special_participant', role]
    if (['human', 'food', 'eaten', 'sold'].includes(specialReason)) {
      return [`reserved_special_target_${specialReason}`, role]
    }
    return ['', '']
  }
  return ['', '']
}

const fingerprint = (date, raw) => {
  const participantIds = Array.isArray(raw.participant_ids) ? raw.participant_ids.map(String).filter(Boolean) : []
  const payload = {
    date,
    type: String(raw.type || ''),
    attacker: String(raw.attacker || ''),
    target: String(raw.target || ''),
    food: String(raw.food || ''),
    group: String(raw.group_id || ''),
    reservation_id: String(raw.reservation_id || ''),
    participant_ids: [...new Set(participantIds)].sort(),
    backfire_victim_id: String(raw.backfire_victim_id || ''),
    backfire_victim_ids: (raw.backfire_victim_ids || []).map(String),
    special_reason: String(raw.special_reason || '')
  }
  const sortValue = value => {
    if (Array.isArray(value)) return value.map(sortValue)
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.keys(value).sort().map(key => [key, sortValue(value[key])]))
    }
    return value
  }
  return crypto.createHash('sha256').update(JSON.stringify(sortValue(payload))).digest('hex')
}

export const normalizeYesterdayEvents = (rawEvents, { date, userId }) => {
  const normalized = []
  const seenReservations = new Set()
  ;(rawEvents || []).forEach((raw, sourceIndex) => {
    if (!raw || typeof raw !== 'object') return
    const eventType = String(raw.type || '')
    const attackerId = String(raw.attacker || '')
    const targetId = String(raw.target || '')
    const participantIds = []
    const participantNames = {}
    if (Array.isArray(raw.participant_ids)) {
      raw.participant_ids.forEach((item, index) => {
        const id = String(item || '')
        if (!id) return
        if (!(id in participantNames)) participantIds.push(id)
        const name = Array.isArray(raw.participant_names) && index < raw.participant_names.length
          ? String(raw.participant_names[index] || '')
          : ''
        if (name || !(id in participantNames)) participantNames[id] = name
      })
    }
    let backfireVictimId = String(raw.backfire_victim_id || '')
    let backfireVictimName = String(raw.backfire_victim_name || '')
    const victimIds = (raw.backfire_victim_ids || []).map(String)
    if (victimIds.includes(userId)) {
      backfireVictimId = userId
      const victimNames = raw.backfire_victim_names || []
      const index = victimIds.indexOf(userId)
      backfireVictimName = index < victimNames.length ? String(victimNames[index] || '') : ''
    }
    const specialReason = String(raw.special_reason || '')
    const reservationId = String(raw.reservation_id || '')
    if (reservationId && attackerId && !(attackerId in participantNames)) {
      participantIds.push(attackerId)
      participantNames[attackerId] = String(raw.attacker_name || '')
    }
    if (reservationId) {
      if (seenReservations.has(reservationId)) return
    }
    const [family, role] = reservationId
      ? familyForReservation({
          eventType, userId, attackerId, targetId, participantIds, backfireVictimId, specialReason
        })
      : familyForNormal(eventType, attackerId, targetId, userId)
    if (!family) return
    const fp = fingerprint(date, raw)
    normalized.push({
      event_id: String(raw.event_id || `legacy-${String(sourceIndex).padStart(8, '0')}-${fp.slice(0, 12)}`),
      created_at: String(raw.created_at || `${date}T00:00:00+00:00`),
      source_index: sourceIndex,
      event_type: eventType,
      family,
      user_role: role,
      attacker_id: attackerId,
      target_id: targetId,
      attacker_name: String(raw.attacker_name || ''),
      target_name: String(raw.target_name || ''),
      food: String(raw.food || ''),
      group_id: String(raw.group_id || ''),
      reservation_id: reservationId,
      participant_ids: participantIds,
      participant_names: participantIds.map(id => participantNames[id] || ''),
      participant_count: Math.max(participantIds.length, Math.max(0, Math.trunc(Number(raw.participant_count) || 0))),
      backfire_victim_id: backfireVictimId,
      backfire_victim_name: backfireVictimName,
      special_reason: specialReason,
      fingerprint: fp
    })
    if (reservationId) seenReservations.add(reservationId)
  })
  return normalized
}

const displayName = (name, scope) => scope === 'group' ? (name || '一名群友') : '一名群友'

const specialReasonText = reason => ({
  human: '它以人类形态出现',
  food: '它现身时已经是熟食',
  eaten: '它出现时只剩空盘',
  sold: '它出现前已经售出'
}[reason] || '它以无法开烤的特殊形态出现')

const experienceContext = (event, scope) => {
  const participantName = new Map(event.participant_ids.map((id, index) => [id, event.participant_names[index] || '']))
  const victimName = event.backfire_victim_name || participantName.get(event.backfire_victim_id) || ''
  return {
    attacker: ['attacker', 'owner'].includes(event.user_role) ? '你' : displayName(event.attacker_name, scope),
    target: event.user_role === 'target' ? '你' : displayName(event.target_name, scope),
    victim: event.user_role === 'backfire_victim' ? '你' : displayName(victimName, scope),
    food: event.food || '一道不明熟食',
    participant_count: event.participant_count,
    other_count: Math.max(0, event.participant_count - 1),
    special_reason: specialReasonText(event.special_reason)
  }
}

const experienceScore = event => {
  const bonus = Math.min(Math.max(event.participant_count - 1, 0), 5)
  if (event.family === 'bot_backfire') return 100
  if (event.family === 'reservation_backfire_victim') return 96
  if (event.reservation_id && event.user_role === 'target') return 93
  if (event.family === 'reservation_success_participant') return 85 + bonus
  if (event.family === 'reserved_special_participant') return 81 + bonus
  if (event.family === 'reservation_backfire_participant') return 79 + bonus
  if (event.family === 'normal_backfire') return 84
  if (event.family === 'self_roast') return 80
  if (event.family === 'reservation_escape_participant') return 75 + bonus
  return {
    escape_as_target: 76,
    success_as_target: 72,
    success_as_attacker: 68,
    escape_as_attacker: 64
  }[event.family] || 0
}

const experiencePoolKey = event => {
  const countAware = new Set([
    'reservation_success_participant', 'reservation_success_target',
    'reservation_escape_participant', 'reservation_escape_target'
  ])
  if (!countAware.has(event.family)) return event.family
  const suffix = event.participant_count >= 2 ? 'multi' : (event.participant_count === 1 ? 'single' : 'unknown')
  return `${event.family}_${suffix}`
}

const createdAtKey = event => {
  const time = Date.parse(event.created_at || '')
  return Number.isFinite(time) ? time : event.source_index
}
const eventIdKey = eventId => /^\d+$/.test(eventId) ? `1:${eventId.padStart(20, '0')}` : `0:${eventId}`

export const selectExperiences = (events, { date, userId, scope, groupId }) => {
  const candidates = events.map(event => {
    const poolKey = experiencePoolKey(event)
    const pool = texts.YESTERDAY_EXPERIENCE_TEXTS?.[poolKey] || []
    const template = stablePick(pool, date, userId, scope, groupId, poolKey, event.fingerprint)
    return {
      family: event.family,
      text: formatText(template, experienceContext(event, scope)),
      event_id: event.event_id,
      fingerprint: event.fingerprint,
      score: experienceScore(event),
      participant_count: event.participant_count,
      created_at_key: createdAtKey(event),
      event_id_key: eventIdKey(event.event_id)
    }
  })
  candidates.sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score
    if (a.participant_count !== b.participant_count) return b.participant_count - a.participant_count
    if (a.created_at_key !== b.created_at_key) return b.created_at_key - a.created_at_key
    if (a.event_id_key !== b.event_id_key) return a.event_id_key < b.event_id_key ? 1 : -1
    return a.fingerprint < b.fingerprint ? -1 : 1
  })
  if (!candidates.length) return []
  const selected = [candidates[0]]
  const second = candidates.slice(1).find(item => item.family !== candidates[0].family)
  if (second) selected.push(second)
  return selected
}

const eventCounts = events => {
  const counts = {
    related_event_count: events.length,
    success_count: 0,
    roasted_count: 0,
    escaped_count: 0,
    backfire_count: 0,
    self_roast_count: 0,
    bot_backfire_count: 0,
    reservation_result_count: 0,
    collaborative_reservation_count: 0,
    targeted_count: 0
  }
  for (const event of events) {
    if (event.reservation_id && ['owner', 'participant', 'backfire_victim'].includes(event.user_role)) {
      counts.reservation_result_count++
      if (event.participant_count >= 2) counts.collaborative_reservation_count++
    }
    if (event.reservation_id && event.user_role === 'target') counts.targeted_count++
    if (['success_as_attacker', 'reservation_success_participant'].includes(event.family)) {
      counts.success_count++
    } else if (['success_as_target', 'reservation_success_target'].includes(event.family)) {
      counts.roasted_count++
      if (!event.reservation_id) counts.targeted_count++
    } else if (['escape_as_target', 'reservation_escape_target'].includes(event.family)) {
      counts.escaped_count++
      if (!event.reservation_id) counts.targeted_count++
    } else if (['normal_backfire', 'reservation_backfire_victim'].includes(event.family)) {
      counts.backfire_count++
    } else if (event.family === 'bot_backfire') {
      counts.backfire_count++
      counts.bot_backfire_count++
    } else if (event.family === 'self_roast') {
      counts.self_roast_count++
    }
  }
  return counts
}

export const buildFootprints = events => {
  const counts = eventCounts(events)
  if (counts.related_event_count < 3) return []
  const definitions = [
    ['bot_backfire_count', '挑战 Bot', 0, 0],
    ['reservation_result_count', '已结算预约', 0, 1],
    ['backfire_count', '反噬落到本人', 1, 0],
    ['escaped_count', '成功逃脱', 1, 1],
    ['success_count', '烤成别人', 2, 0],
    ['roasted_count', '被成功烤', 2, 1],
    ['self_roast_count', '自烤', 3, 0]
  ]
  return definitions
    .filter(([key]) => counts[key] > 0)
    .sort((a, b) => {
      if (a[2] !== b[2]) return a[2] - b[2]
      if (counts[b[0]] !== counts[a[0]]) return counts[b[0]] - counts[a[0]]
      return a[3] - b[3]
    })
    .slice(0, 3)
    .map(([key, label]) => ({ kind: key, label, count: counts[key] }))
}

export const buildSummary = (events, { date, userId, scope, groupId }) => {
  const counts = eventCounts(events)
  const related = counts.related_event_count
  if (related <= 0) {
    return {
      kind: 'none',
      text: scope === 'group'
        ? '本群昨天没有发生与你有关的烤猪事件。'
        : '昨天没有记录到与你有关的烤猪事件。'
    }
  }
  if (related < 3) return null
  const passive = counts.roasted_count + counts.escaped_count
  let kind = ''
  if (counts.self_roast_count >= 2) kind = 'self_service'
  else if (counts.backfire_count >= 2) kind = 'cursed'
  else if (counts.escaped_count >= 3 && counts.targeted_count > 0 && counts.escaped_count / counts.targeted_count >= 0.6) kind = 'escape_artist'
  else if (counts.roasted_count >= 3 && counts.roasted_count / related >= 0.5) kind = 'victim'
  else if (counts.collaborative_reservation_count >= 2 && counts.collaborative_reservation_count / related >= 0.5) kind = 'team_player'
  else if (counts.success_count >= 3 && counts.success_count / related >= 0.5) kind = 'chef'
  else if (counts.success_count >= 2 && passive >= 2) kind = 'chaotic'
  if (!kind) return null
  const signature = JSON.stringify(Object.fromEntries(Object.keys(counts).sort().map(key => [key, counts[key]])))
  return {
    kind,
    text: stablePick(texts.YESTERDAY_SUMMARY_TEXTS?.[kind] || [], date, userId, scope, groupId, kind, signature)
  }
}

export const buildOutcomeText = snapshot => {
  if (!snapshot) return ''
  if (snapshot.is_new_pig) {
    return snapshot.collection_size ? `新猪入圈 · 图鉴第 ${snapshot.collection_size} 只` : '新猪入圈'
  }
  const previousLevel = Number(snapshot.previous_level) || 0
  const currentLevel = Number(snapshot.level) || expertLevel(snapshot.copies)
  if (currentLevel <= previousLevel) return ''
  const prefix = `EX Lv.${previousLevel} → ${currentLevel}`
  const unlocked = newlyUnlockedVariantLevels(snapshot.pig_id, previousLevel, currentLevel)
  const fields = variantFieldsForLevels(snapshot.pig_id, unlocked)
  const hasImage = fields.includes('image')
  const hasText = fields.includes('text')
  if (hasImage && hasText) return `${prefix} · 新立绘与介绍已解锁`
  if (hasImage) return `${prefix} · 新立绘已解锁`
  if (hasText) return `${prefix} · 新介绍已解锁`
  return prefix
}

/** 组装昨日回顾；没有昨日快照返回 null */
export const buildYesterdayRecap = ({ userId, groupId = '', date = '' }) => {
  const targetDate = date
  const snapshot = getDailySnapshot(targetDate, userId)
  if (!snapshot) return null
  const scope = groupId ? 'group' : 'cross_group'
  const pig = getPigById(listOfficialPigs(), snapshot.pig_id)
  let replayLevel = Number(snapshot.level) || 0
  const feed = getState().daily_feeds?.[targetDate]?.[String(userId)]
  if (feed && String(feed.pig_id) === String(snapshot.pig_id) && Number(feed.new_level) > replayLevel) {
    replayLevel = Number(feed.new_level)
  }
  const appearance = pig ? resolveAppearance(pig, replayLevel) : null
  const pigName = appearance?.pig?.name || snapshot.pig_id
  const base = {
    date_str: targetDate,
    scope,
    group_id: String(groupId || ''),
    snapshot,
    pig_id: snapshot.pig_id,
    pig_name: pigName,
    pig_description: appearance?.pig?.description || '',
    pig_analysis: appearance?.pig?.analysis || '',
    image_path: appearance?.imagePath || '',
    fallback_image_path: appearance?.baseImagePath || '',
    outcome_text: buildOutcomeText(snapshot),
    footprints: [],
    experiences: [],
    summary: null,
    aftereffect_text: '',
    events_available: true
  }
  if (snapshot.is_makeup) {
    return { ...base, events_available: false }
  }
  const rawEvents = queryEvents({ date: targetDate, groupId: String(groupId || '') })
  const events = normalizeYesterdayEvents(rawEvents, { date: targetDate, userId: String(userId) })
  const footprints = buildFootprints(events)
  const experiences = selectExperiences(events, {
    date: targetDate, userId: String(userId), scope, groupId: String(groupId || '')
  })
  const summary = buildSummary(events, {
    date: targetDate, userId: String(userId), scope, groupId: String(groupId || '')
  })
  let aftereffect = ''
  if (groupId && isProtected(todayStr(), String(groupId), String(userId))) {
    aftereffect = '昨天挨的烤没白挨：今天你在本群获得了一层保护，普通烤猪会被拦下。'
  }
  return {
    ...base,
    footprints,
    experiences,
    summary,
    aftereffect_text: aftereffect
  }
}

