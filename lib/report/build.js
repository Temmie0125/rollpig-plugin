// 猪圈日报业务层：1:1 移植 plus 的 daily_report.py 选择规则，不包含任何渲染代码。
const KNOWN_EVENT_TYPES = new Set(['success', 'escape', 'backfire', 'bot_backfire', 'self_roast', 'reserved_special'])
const OBSERVATION_PRIORITY = ['reservation', 'backfire', 'escape', 'success', 'human', 'collision', 'variety']
const TIMELINE_PRIORITY = ['mutual', 'personal_turn', 'reservation_followup', 'repeat_target']
const HEADLINE_BASE_SCORE = {
  normal_success: 35,
  normal_escape: 40,
  normal_backfire: 45,
  self_roast: 35,
  bot_backfire: 60,
  reservation_success: 35,
  reservation_escape: 40,
  reservation_backfire: 50,
  reservation_human: 50,
  reservation_food: 50,
  reservation_eaten: 50,
  reservation_sold: 50
}

const text = value => String(value ?? '').trim()
const parseTime = value => {
  const normalized = text(value)
  if (!normalized) return null
  const time = Date.parse(normalized)
  return Number.isFinite(time) ? time : null
}
const timeKey = value => {
  const parsed = parseTime(value)
  return parsed === null ? [1, text(value)] : [0, new Date(parsed).toISOString()]
}
const compareTuple = (a, b) => {
  for (let index = 0; index < Math.max(a.length, b.length); index++) {
    if (a[index] === b[index]) continue
    return a[index] < b[index] ? -1 : 1
  }
  return 0
}
const eventSortKey = event => [timeKey(event.created_at), event.event_id]

const participantFields = (rawIds, rawNames) => {
  if (!Array.isArray(rawIds)) return { ids: [], names: [] }
  const names = Array.isArray(rawNames) ? rawNames : []
  const ids = []
  const resultNames = []
  rawIds.forEach((rawId, index) => {
    const id = text(rawId)
    if (!id) return
    ids.push(id)
    resultNames.push(index < names.length ? text(names[index]) : '')
  })
  return { ids, names: resultNames }
}

export const normalizeDailyEvents = (rawEvents, { groupId = '', cutoffIso = '' } = {}) => {
  const expectedGroup = text(groupId)
  const cutoff = parseTime(cutoffIso)
  const normalized = []
  ;(rawEvents || []).forEach((raw, index) => {
    if (!raw || typeof raw !== 'object') return
    const eventType = text(raw.type || raw.event_type)
    if (!KNOWN_EVENT_TYPES.has(eventType)) return
    const eventGroup = text(raw.group_id)
    if (expectedGroup && eventGroup && eventGroup !== expectedGroup) return
    const participants = participantFields(raw.participant_ids, raw.participant_names)
    const victims = participantFields(raw.backfire_victim_ids, raw.backfire_victim_names)
    const protectionLevel = Math.max(0, Math.min(5, Math.trunc(Number(raw.protection_level) || 0)))
    const event = {
      event_id: text(raw.event_id) || `legacy:${String(index).padStart(6, '0')}`,
      event_type: eventType,
      attacker_id: text(raw.attacker),
      target_id: text(raw.target),
      attacker_name: text(raw.attacker_name),
      target_name: text(raw.target_name),
      food: text(raw.food),
      group_id: eventGroup || expectedGroup,
      reservation_id: text(raw.reservation_id),
      participant_ids: participants.ids,
      participant_names: participants.names,
      participant_count: Math.max(Math.trunc(Number(raw.participant_count) || 0), participants.ids.length),
      backfire_victim_id: text(raw.backfire_victim_id),
      backfire_victim_name: text(raw.backfire_victim_name),
      backfire_victim_ids: victims.ids,
      backfire_victim_names: victims.names,
      special_reason: text(raw.special_reason),
      created_at: text(raw.created_at),
      force_mode: text(raw.force_mode),
      protection_level: protectionLevel,
      reservation_owner_id: text(raw.reservation_owner_id),
      reservation_owner_name: text(raw.reservation_owner_name)
    }
    const eventTime = parseTime(event.created_at)
    if (cutoff !== null && eventTime !== null && eventTime > cutoff) return
    normalized.push(event)
  })
  normalized.sort((a, b) => compareTuple(eventSortKey(a), eventSortKey(b)))
  return normalized
}

export const isReservation = event => Boolean(event?.reservation_id)
export const resultKind = event => {
  if (!event) return ''
  if (event.event_type === 'backfire' || event.event_type === 'bot_backfire') return 'backfire'
  if (event.event_type === 'reserved_special') return 'special'
  return event.event_type
}

const normalizeGroupRolls = groupRolls => {
  const normalized = {}
  for (const [rawUserId, rawPig] of Object.entries(groupRolls || {})) {
    const userId = text(rawUserId)
    const pigId = text(typeof rawPig === 'object' ? rawPig?.pig_id : rawPig)
    if (userId && pigId) normalized[userId] = pigId
  }
  return normalized
}

const collectDisplayNames = (events, profiles) => {
  const names = {}
  for (const [userId, profile] of Object.entries(profiles || {})) {
    if (userId && profile?.display_name) names[userId] = profile.display_name
  }
  const live = new Set(Object.keys(names))
  for (const event of events) {
    for (const [userId, displayName] of [
      [event.attacker_id, event.attacker_name],
      [event.target_id, event.target_name],
      [event.backfire_victim_id, event.backfire_victim_name]
    ]) {
      if (userId && displayName && !live.has(userId)) names[userId] = displayName
    }
    event.participant_ids.forEach((userId, index) => {
      if (userId && event.participant_names[index] && !live.has(userId)) names[userId] = event.participant_names[index]
    })
    event.backfire_victim_ids.forEach((userId, index) => {
      if (userId && event.backfire_victim_names[index] && !live.has(userId)) names[userId] = event.backfire_victim_names[index]
    })
  }
  return names
}

const collectParticipants = (groupRolls, events, activeUserIds, botUserIds) => {
  const users = new Set((activeUserIds || []).map(text))
  Object.keys(groupRolls).forEach(id => users.add(id))
  for (const event of events) {
    users.add(event.attacker_id)
    if (event.event_type !== 'bot_backfire') users.add(event.target_id)
    event.participant_ids.forEach(id => users.add(id))
    users.add(event.backfire_victim_id)
    event.backfire_victim_ids.forEach(id => users.add(id))
  }
  users.delete('')
  for (const botId of botUserIds || []) users.delete(String(botId))
  return [...users].sort()
}

export const buildDailyOverview = (groupRolls, events, humanPigIds = new Set(['human'])) => {
  const rolls = normalizeGroupRolls(groupRolls)
  const ordinaryEvents = events.filter(event => !isReservation(event) && event.event_type !== 'self_roast')
  const reservationEvents = events.filter(isReservation)
  const pigCounts = new Map()
  for (const pigId of Object.values(rolls)) pigCounts.set(pigId, (pigCounts.get(pigId) || 0) + 1)
  let topPigId = ''
  let topPigCount = 0
  for (const [pigId, count] of pigCounts) {
    if (count > topPigCount) {
      topPigId = pigId
      topPigCount = count
    }
  }
  return {
    roll_count: Object.keys(rolls).length,
    ordinary_roast_count: ordinaryEvents.length,
    reservation_count: new Set(reservationEvents.map(event => event.reservation_id || event.event_id)).size,
    escape_count: events.filter(event => event.event_type === 'escape').length,
    backfire_count: events.filter(event => event.event_type === 'backfire' || event.event_type === 'bot_backfire').length,
    pig_variety_count: new Set(Object.values(rolls)).size,
    human_count: Object.values(rolls).filter(pigId => humanPigIds.has(pigId)).length,
    ordinary_success_count: events.filter(event => event.event_type === 'success' && !isReservation(event)).length,
    top_pig_id: topPigId,
    top_pig_count: topPigCount
  }
}

export const selectOverviewMetrics = overview => {
  const metrics = [
    { kind: 'roll_count', label: '小猪数量', value: overview.roll_count, unit: '头' },
    { kind: 'ordinary_roast', label: '普通烤猪', value: overview.ordinary_roast_count, unit: '次' }
  ]
  if (overview.reservation_count > 0) metrics.push({ kind: 'reservation', label: '预约烤猪', value: overview.reservation_count, unit: '场' })
  else if (overview.escape_count > 0) metrics.push({ kind: 'escape', label: '成功逃脱', value: overview.escape_count, unit: '次' })
  else if (overview.backfire_count > 0) metrics.push({ kind: 'backfire', label: '意外翻车', value: overview.backfire_count, unit: '次' })
  else if (overview.pig_variety_count > 0) metrics.push({ kind: 'pig_variety', label: '小猪种类', value: overview.pig_variety_count, unit: '种' })
  return metrics
}

const counter = () => {
  const map = new Map()
  return {
    add: (key, amount = 1) => map.set(key, (map.get(key) || 0) + amount),
    get: key => map.get(key) || 0,
    max: (kinds, order) => {
      let best = ''
      let bestValue = -1
      let bestIndex = Infinity
      for (const kind of kinds) {
        const value = map.get(kind) || 0
        const index = order.indexOf(kind)
        if (value > bestValue || (value === bestValue && index < bestIndex)) {
          best = kind
          bestValue = value
          bestIndex = index
        }
      }
      return best
    }
  }
}

export const selectObservation = (overview, groupRolls, events) => {
  const rolls = normalizeGroupRolls(groupRolls)
  const totalRoasts = overview.ordinary_roast_count + overview.reservation_count
  const reservationResults = counter()
  const allResults = counter()
  const ordinaryResults = counter()
  for (const event of events) {
    const kind = resultKind(event)
    if (!['success', 'escape', 'backfire'].includes(kind)) continue
    allResults.add(kind)
    if (isReservation(event)) reservationResults.add(kind)
    else if (event.event_type !== 'self_roast') ordinaryResults.add(kind)
  }
  const dominant = reservationResults.max(['success', 'escape', 'backfire'], ['success', 'escape', 'backfire'])
  const candidates = {}
  if (overview.reservation_count >= 3 || (overview.reservation_count >= 2 && totalRoasts > 0 && overview.reservation_count / totalRoasts >= 0.30)) {
    candidates.reservation = {
      kind: 'reservation', total: totalRoasts, matched: overview.reservation_count, dominant_result: dominant,
      success_count: reservationResults.get('success'), escape_count: reservationResults.get('escape'), backfire_count: reservationResults.get('backfire')
    }
  }
  if ((totalRoasts >= 4 && overview.backfire_count / totalRoasts >= 0.30) ||
    (totalRoasts >= 3 && overview.backfire_count >= 2 && overview.backfire_count / totalRoasts >= 0.50)) {
    candidates.backfire = {
      kind: 'backfire', total: totalRoasts, matched: overview.backfire_count,
      success_count: allResults.get('success'), escape_count: allResults.get('escape'), backfire_count: allResults.get('backfire')
    }
  }
  if ((totalRoasts >= 5 && overview.escape_count / totalRoasts >= 0.40) ||
    (totalRoasts >= 3 && overview.escape_count >= 2 && overview.escape_count / totalRoasts >= 0.50)) {
    candidates.escape = {
      kind: 'escape', total: totalRoasts, matched: overview.escape_count,
      success_count: allResults.get('success'), escape_count: allResults.get('escape'), backfire_count: allResults.get('backfire')
    }
  }
  if ((overview.ordinary_roast_count >= 5 && overview.ordinary_success_count / overview.ordinary_roast_count >= 0.60) ||
    (overview.ordinary_roast_count >= 3 && overview.ordinary_success_count >= 3 && overview.ordinary_success_count / overview.ordinary_roast_count >= 0.75)) {
    candidates.success = {
      kind: 'success', total: overview.ordinary_roast_count, matched: overview.ordinary_success_count,
      success_count: ordinaryResults.get('success'), escape_count: ordinaryResults.get('escape'), backfire_count: ordinaryResults.get('backfire')
    }
  }
  if (overview.human_count >= 2 || (overview.roll_count >= 8 && overview.human_count / overview.roll_count >= 0.15)) {
    candidates.human = { kind: 'human', total: overview.roll_count, matched: overview.human_count }
  }
  const pigCounts = new Map()
  for (const pigId of Object.values(rolls)) pigCounts.set(pigId, (pigCounts.get(pigId) || 0) + 1)
  const maxPigCount = Math.max(0, ...pigCounts.values())
  const duplicateCount = Math.max(0, overview.roll_count - overview.pig_variety_count)
  if (overview.roll_count > 0 && (maxPigCount >= 3 || duplicateCount / overview.roll_count >= 0.25)) {
    candidates.collision = { kind: 'collision', total: overview.roll_count, matched: duplicateCount }
  }
  if (overview.roll_count >= 8 && overview.pig_variety_count / overview.roll_count >= 0.90 && maxPigCount <= 2) {
    candidates.variety = { kind: 'variety', total: overview.roll_count, matched: overview.pig_variety_count }
  }
  return OBSERVATION_PRIORITY.map(kind => candidates[kind]).find(Boolean) || null
}

export const reservationPartySize = event => {
  const ids = new Set(event.participant_ids || [])
  if (event.force_mode === 'super') return Math.max(1, event.participant_count || 0, ids.size)
  return Math.max(
    1,
    event.participant_count || 0,
    ids.size + (ids.has(event.attacker_id) ? 0 : 1)
  )
}

const pairKey = event => {
  if (!event.attacker_id || !event.target_id) return null
  return [event.attacker_id, event.target_id].sort().join('\u0000')
}

const headlineKind = event => {
  if (event.force_mode === 'super' && event.event_type === 'success') return 'normal_success'
  if (isReservation(event)) {
    if (event.event_type === 'success') return 'reservation_success'
    if (event.event_type === 'escape') return 'reservation_escape'
    if (event.event_type === 'backfire') return 'reservation_backfire'
    if (event.event_type === 'reserved_special' && ['human', 'food', 'eaten', 'sold'].includes(event.special_reason)) {
      return `reservation_${event.special_reason}`
    }
    return null
  }
  return {
    success: 'normal_success',
    escape: 'normal_escape',
    backfire: 'normal_backfire',
    self_roast: 'self_roast',
    bot_backfire: 'bot_backfire'
  }[event.event_type] || null
}

export const selectHeadline = events => {
  const pairCounts = new Map()
  for (const event of events) {
    const key = pairKey(event)
    if (key) pairCounts.set(key, (pairCounts.get(key) || 0) + 1)
  }
  const interactionEvents = events.filter(event => event.event_type !== 'self_roast')
  const activeDay = interactionEvents.length >= 3
  const mixedResults = new Set(interactionEvents.map(resultKind)).size >= 2
  const candidates = []
  for (const event of events) {
    const kind = headlineKind(event)
    if (!kind) continue
    const key = pairKey(event)
    const repeated = Math.max(0, (pairCounts.get(key) || 0) - 1)
    const party = isReservation(event) ? reservationPartySize(event) : 0
    if (event.force_mode === 'super') {
      if (!event.protection_level && party <= 1 && !(activeDay && (mixedResults || repeated))) continue
    } else if (isReservation(event)) {
      if (party === 1) continue
      if (party === 2 && ['reservation_success', 'reservation_escape'].includes(kind) &&
        !(activeDay && (mixedResults || repeated))) continue
    } else if (['normal_success', 'normal_escape', 'normal_backfire'].includes(kind)) {
      if (!(activeDay && (mixedResults || repeated))) continue
    } else if (kind === 'self_roast' && repeated < 4) {
      continue
    }
    const sizeBonus = party >= 10 ? 15 : (party >= 6 ? 10 : 0)
    const score = (event.force_mode === 'super' ? 45 : HEADLINE_BASE_SCORE[kind]) +
      Math.min(Math.max(0, party - 1), 5) * 5 +
      sizeBonus +
      Math.min(repeated, 3) * 5 +
      (event.protection_level ? 10 + 5 * (event.protection_level - 1) : 0) +
      Math.min(20, Math.max(0, new Set(event.backfire_victim_ids).size - 1) * 5)
    candidates.push({ kind, score, repeated, event })
  }
  if (!candidates.length) return null
  candidates.sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score
    const partyA = isReservation(a.event) ? reservationPartySize(a.event) : 0
    const partyB = isReservation(b.event) ? reservationPartySize(b.event) : 0
    if (partyA !== partyB) return partyB - partyA
    if (HEADLINE_BASE_SCORE[a.kind] !== HEADLINE_BASE_SCORE[b.kind]) return HEADLINE_BASE_SCORE[b.kind] - HEADLINE_BASE_SCORE[a.kind]
    const timeCompare = compareTuple(timeKey(a.event.created_at), timeKey(b.event.created_at))
    if (timeCompare) return timeCompare
    return a.event.event_id < b.event.event_id ? -1 : 1
  })
  return candidates[0]
}

const uniqueEvents = events => {
  const map = new Map()
  for (const event of events) map.set(event.event_id, event)
  return [...map.values()].sort((a, b) => compareTuple(eventSortKey(a), eventSortKey(b)))
}

const buildTimelineCandidates = events => {
  const candidates = []
  const directed = new Map()
  const initiated = new Map()
  for (const event of events) {
    if (event.attacker_id) {
      if (!initiated.has(event.attacker_id)) initiated.set(event.attacker_id, [])
      initiated.get(event.attacker_id).push(event)
    }
    if (event.attacker_id && event.target_id && event.attacker_id !== event.target_id) {
      const key = `${event.attacker_id}\u0000${event.target_id}`
      if (!directed.has(key)) directed.set(key, [])
      directed.get(key).push(event)
    }
  }
  const seenMutual = new Set()
  for (const [key, pairEvents] of directed) {
    const [attackerId, targetId] = key.split('\u0000')
    const pair = [attackerId, targetId].sort().join('\u0000')
    if (seenMutual.has(pair) || !directed.has(`${targetId}\u0000${attackerId}`)) continue
    seenMutual.add(pair)
    candidates.push({
      kind: 'mutual',
      identity: pair,
      events: uniqueEvents([...pairEvents, ...(directed.get(`${targetId}\u0000${attackerId}`) || [])]),
      anchor: null
    })
  }
  for (const [userId, userEvents] of initiated) {
    const ordered = uniqueEvents(userEvents)
    if (ordered.length < 3) continue
    const results = new Set(ordered.map(resultKind))
    const mixesReservation = ordered.some(isReservation) && ordered.some(event => !isReservation(event))
    if (results.size > 1 || mixesReservation) {
      candidates.push({ kind: 'personal_turn', identity: userId, events: ordered, anchor: null })
    }
  }
  for (const reservationEvent of events.filter(isReservation)) {
    const ownerId = reservationEvent.attacker_id
    const targetId = reservationEvent.target_id
    if (!ownerId || !targetId || ownerId === targetId) continue
    const pair = new Set([ownerId, targetId])
    const related = [reservationEvent, ...events.filter(event =>
      !isReservation(event) &&
      pair.has(event.attacker_id) && pair.has(event.target_id) &&
      compareTuple(eventSortKey(event), eventSortKey(reservationEvent)) > 0
    )]
    const ordered = uniqueEvents(related)
    if (ordered.length >= 2) {
      candidates.push({
        kind: 'reservation_followup',
        identity: reservationEvent.reservation_id,
        events: ordered,
        anchor: reservationEvent
      })
    }
  }
  for (const [key, pairEvents] of directed) {
    const ordered = uniqueEvents(pairEvents)
    if (ordered.length >= 2) {
      candidates.push({ kind: 'repeat_target', identity: key.replace('\u0000', ':'), events: ordered, anchor: null })
    }
  }
  return candidates
}

export const selectTimeline = (events, headline) => {
  const headlineId = headline?.event?.event_id || ''
  const candidates = []
  for (const candidate of buildTimelineCandidates(events)) {
    const remaining = candidate.events.filter(event => event.event_id !== headlineId)
    if (remaining.length >= 2) candidates.push({ ...candidate, events: remaining })
  }
  if (!candidates.length) return null
  candidates.sort((a, b) => {
    const priority = TIMELINE_PRIORITY.indexOf(a.kind) - TIMELINE_PRIORITY.indexOf(b.kind)
    if (priority) return priority
    if (a.events.length !== b.events.length) return b.events.length - a.events.length
    const resultA = new Set(a.events.map(resultKind)).size
    const resultB = new Set(b.events.map(resultKind)).size
    if (resultA !== resultB) return resultB - resultA
    const specialA = a.events.some(event => isReservation(event) || resultKind(event) === 'backfire') ? 1 : 0
    const specialB = b.events.some(event => isReservation(event) || resultKind(event) === 'backfire') ? 1 : 0
    if (specialA !== specialB) return specialB - specialA
    const timeCompare = compareTuple(eventSortKey(a.events[0]), eventSortKey(b.events[0]))
    if (timeCompare) return timeCompare
    return a.identity < b.identity ? -1 : 1
  })
  const selected = candidates[0]
  return { kind: selected.kind, events: selected.events.slice(0, 3), anchor: selected.anchor }
}

const rankEntries = rows => {
  if (!rows.length) return null
  const ordered = [...rows].sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score
    const timeCompare = compareTuple(timeKey(a.achievedAt), timeKey(b.achievedAt))
    if (timeCompare) return timeCompare
    return a.userId < b.userId ? -1 : 1
  })
  let previousScore = null
  let currentRank = 0
  return ordered.slice(0, 3).map((row, index) => {
    if (row.score !== previousScore) {
      currentRank = index + 1
      previousScore = row.score
    }
    return { ...row, rank: currentRank }
  })
}

export const buildRankings = (participantIds, groupRolls, events, profiles, displayNames) => {
  const rolls = normalizeGroupRolls(groupRolls)
  const candidates = new Set(participantIds)
  const successEvents = new Map()
  for (const event of events) {
    if (event.event_type !== 'success') continue
    if (!(!isReservation(event) || event.force_mode === 'super')) continue
    if (!candidates.has(event.attacker_id)) continue
    if (!successEvents.has(event.attacker_id)) successEvents.set(event.attacker_id, [])
    successEvents.get(event.attacker_id).push(event)
  }
  const exRows = []
  const successRows = []
  const catalogRows = []
  for (const userId of [...candidates].sort()) {
    const profile = profiles?.[userId] || {}
    const displayName = profile.display_name || displayNames[userId] || userId
    const dailyPigId = rolls[userId] || ''
    if (dailyPigId && profile.daily_ex_level !== null && profile.daily_ex_level !== undefined) {
      exRows.push({
        userId, displayName, score: Math.max(0, Math.trunc(Number(profile.daily_ex_level) || 0)),
        pigId: dailyPigId, pigName: profile.daily_pig_name || '', imageName: profile.daily_image_name || '',
        achievedAt: profile.daily_achieved_at || '', fallback: false
      })
    }
    const successes = (successEvents.get(userId) || []).sort((a, b) => compareTuple(eventSortKey(a), eventSortKey(b)))
    if (successes.length && dailyPigId) {
      successRows.push({
        userId, displayName, score: successes.length,
        pigId: dailyPigId, pigName: profile.daily_pig_name || '', imageName: profile.daily_image_name || '',
        achievedAt: successes[successes.length - 1].created_at, fallback: false
      })
    }
    if (profile.catalog_count !== null && profile.catalog_count !== undefined && Number(profile.catalog_count) > 0) {
      const pigId = dailyPigId || profile.recent_pig_id || ''
      catalogRows.push({
        userId, displayName, score: Math.trunc(Number(profile.catalog_count) || 0),
        pigId,
        pigName: dailyPigId ? (profile.daily_pig_name || '') : (profile.recent_pig_name || ''),
        imageName: dailyPigId ? (profile.daily_image_name || '') : (profile.recent_image_name || ''),
        achievedAt: profile.catalog_achieved_at || '',
        fallback: !pigId
      })
    }
  }
  return [
    { kind: 'expert_level', entries: rankEntries(exRows) },
    { kind: 'roast_success', entries: rankEntries(successRows) },
    { kind: 'catalog', entries: rankEntries(catalogRows) }
  ].filter(ranking => ranking.entries && ranking.entries.length)
}

export const buildDailyReport = ({
  date,
  groupId,
  groupRolls = {},
  rawEvents = [],
  activeUserIds = [],
  botUserIds = [],
  profiles = {},
  protections = [],
  humanPigIds = ['human'],
  cutoffIso = ''
}) => {
  const events = normalizeDailyEvents(rawEvents, { groupId, cutoffIso })
  const botIds = new Set((botUserIds || []).map(String))
  const rolls = normalizeGroupRolls(groupRolls)
  for (const botId of botIds) delete rolls[botId]
  const participantIds = collectParticipants(rolls, events, activeUserIds, botIds)
  const displayNames = collectDisplayNames(events, profiles)
  const overview = buildDailyOverview(rolls, events, new Set(humanPigIds))
  const overviewMetrics = selectOverviewMetrics(overview)
  const observation = selectObservation(overview, rolls, events)
  const headline = selectHeadline(events)
  const timeline = selectTimeline(events, headline)
  const rankings = buildRankings(participantIds, rolls, events, profiles, displayNames)
  return {
    date_str: date,
    group_id: String(groupId),
    has_activity: Boolean(Object.keys(rolls).length || events.length || participantIds.length),
    participant_ids: participantIds,
    display_names: displayNames,
    events,
    overview,
    overview_metrics: overviewMetrics,
    observation,
    headline,
    timeline,
    rankings,
    protections,
    group_rolls: rolls
  }
}

export const reportEventSortKey = eventSortKey
