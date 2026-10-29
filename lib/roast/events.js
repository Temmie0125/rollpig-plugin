// 烤猪事件流与“被烤次数”统计。日报、昨日回顾、次日保护都依赖同一份事件。
import { mutateState, getState } from '../state.js'
import { nowIso, todayStr } from '../time.js'

const makeEventId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`

export const buildEventRecord = event => {
  const date = String(event?.date || todayStr())
  return {
    event_id: event.event_id || makeEventId(),
    date,
    created_at: event.created_at || nowIso(),
    type: String(event.type || ''),
    attacker: String(event.attacker || ''),
    target: String(event.target || ''),
    attacker_name: String(event.attacker_name || ''),
    target_name: String(event.target_name || ''),
    food: String(event.food || ''),
    group_id: String(event.group_id || ''),
    reservation_id: String(event.reservation_id || ''),
    participant_ids: (event.participant_ids || []).map(String),
    participant_names: (event.participant_names || []).map(String),
    participant_count: Math.max(0, Math.trunc(Number(event.participant_count) || 0)),
    backfire_victim_id: String(event.backfire_victim_id || ''),
    backfire_victim_ids: (event.backfire_victim_ids || []).map(String),
    backfire_victim_names: (event.backfire_victim_names || []).map(String),
    special_reason: String(event.special_reason || ''),
    force_mode: String(event.force_mode || ''),
    protection_level: Math.max(0, Math.trunc(Number(event.protection_level) || 0)),
    reservation_owner_id: String(event.reservation_owner_id || ''),
    reservation_owner_name: String(event.reservation_owner_name || '')
  }
}

export const appendRoastEvent = async event => {
  const date = String(event?.date || todayStr())
  return mutateState(state => {
    state.events ||= {}
    state.events[date] ||= []
    const list = state.events[date]
    if (event.reservation_id && list.some(item => item?.reservation_id === event.reservation_id)) {
      return null
    }
    const record = buildEventRecord(event)
    list.push(record)
    return record
  })
}

/** 只读查询；cutoffIso 为日报 23:45 截止点，空则不限 */
export const queryEvents = ({ date, groupId = '', cutoffIso = '' } = {}) => {
  const list = getState().events?.[date] || []
  const cutoff = cutoffIso ? Date.parse(cutoffIso) : NaN
  return list.filter(event => {
    if (!event || typeof event !== 'object') return false
    if (groupId && String(event.group_id || '') !== String(groupId)) return false
    if (Number.isFinite(cutoff)) {
      const created = Date.parse(event.created_at || '')
      if (Number.isFinite(created) && created > cutoff) return false
    }
    return true
  })
}

/**
 * 统计被烤次数：success 计目标；backfire/bot_backfire 计实际受害者；
 * bot 反噬与未抽猪惩罚在同群同日同人同种只计一次。
 * 返回 Map，保持首次出现顺序。
 */
export const countRoastedUsers = events => {
  const counts = new Map()
  const specialSeen = new Set()
  const eventSeen = new Set()
  for (const event of events || []) {
    if (!event || typeof event !== 'object') continue
    const date = String(event.date || event.date_str || '')
    const eventId = String(event.event_id || '')
    if (eventId) {
      const key = `${date}|${eventId}`
      if (eventSeen.has(key)) continue
      eventSeen.add(key)
    }
    const kind = String(event.type || event.event_type || '')
    const attacker = String(event.attacker || event.attacker_id || '')
    const target = String(event.target || event.target_id || '')
    let victims = []
    let specialKind = ''
    if (kind === 'success' && target && target !== attacker) {
      victims = [target]
    } else if (kind === 'backfire' || kind === 'bot_backfire') {
      const explicit = Array.isArray(event.backfire_victim_ids) ? event.backfire_victim_ids : []
      victims = explicit.length
        ? explicit
        : [event.backfire_victim_id || attacker]
      if (kind === 'bot_backfire') specialKind = 'bot'
      else if (String(event.special_reason || '') === 'unrolled') specialKind = 'unrolled'
    } else {
      continue
    }
    for (const rawVictim of new Set(victims.map(String).filter(Boolean))) {
      if (specialKind) {
        const key = `${date}|${event.group_id || ''}|${rawVictim}|${specialKind}`
        if (specialSeen.has(key)) continue
        specialSeen.add(key)
      }
      counts.set(rawVictim, (counts.get(rawVictim) || 0) + 1)
    }
  }
  return counts
}

/** 取被烤最多的人；平票按 Map 首次出现顺序，与 plus 的 Counter.most_common 一致 */
export const topRoastedUser = (events, minimum = 2) => {
  let bestId = ''
  let bestCount = 0
  for (const [userId, count] of countRoastedUsers(events)) {
    if (count > bestCount) {
      bestId = userId
      bestCount = count
    }
  }
  return bestCount >= minimum ? { userId: bestId, count: bestCount } : null
}
