// 日报数据装配：只读取状态和群成员昵称，不写入任何东西。
import { getState } from '../state.js'
import { addDays } from '../time.js'
import { expertLevel, getPigById, loadPigRules, mergedPigs, resolveAppearance } from '../pigs.js'
import { queryEvents, countRoastedUsers, topRoastedUser } from '../roast/events.js'
import { getProtectionEntry, protectedUserIds, hasSettlement } from '../roast/protection.js'
import { buildDailyReport } from './build.js'

const parseMs = value => {
  const time = Date.parse(value || '')
  return Number.isFinite(time) ? time : null
}

const beforeCutoff = (value, cutoffIso) => {
  const cutoff = parseMs(cutoffIso)
  if (cutoff === null) return true
  const time = parseMs(value)
  return time === null || time <= cutoff
}

const memberName = member => member?.card || member?.nickname || member?.name || ''

const loadMemberNames = async groupId => {
  const names = {}
  try {
    const bot = globalThis.Bot
    const group = bot?.pickGroup?.(groupId)
    if (!group?.getMemberMap) return names
    const map = await group.getMemberMap()
    if (!map) return names
    for (const [rawId, member] of map instanceof Map ? map.entries() : Object.entries(map)) {
      const name = memberName(member)
      if (name) names[String(rawId)] = name
    }
  } catch (error) {
    ;(globalThis.logger || console).warn?.(`[猪圈日报] 读取群成员昵称失败 group=${groupId}:`, error)
  }
  return names
}

const recentPig = (state, userId, date) => {
  const dates = Object.keys(state.history || {}).filter(key => key < date).sort().reverse()
  for (const key of dates) {
    const pigId = state.history[key]?.[userId]
    if (pigId) return { pigId, achievedAt: state.snapshots?.[key]?.[userId]?.created_at || '' }
  }
  return null
}

const catalogCount = (state, userId, map) => {
  const progress = state.pig_progress?.[userId] || {}
  let count = 0
  for (const [pigId, entry] of Object.entries(progress)) {
    if (map.has(pigId) && Number(entry?.copies) > 0) count++
  }
  return count
}

const buildProfile = ({ state, userId, date, groupRolls, map, liveNames }) => {
  const dailyPigId = groupRolls[userId] || state.history?.[date]?.[userId] || ''
  const progress = state.pig_progress?.[userId]?.[dailyPigId] || {}
  const level = dailyPigId ? expertLevel(progress.copies, progress.growth_bonus) : 0
  const dailyPig = dailyPigId ? map.get(String(dailyPigId)) : null
  const appearance = dailyPig ? resolveAppearance(dailyPig, level) : null
  const recent = recentPig(state, userId, date)
  const recentPigEntry = recent?.pigId ? map.get(String(recent.pigId)) : null
  const recentAppearance = recentPigEntry ? resolveAppearance(recentPigEntry, expertLevel(
    state.pig_progress?.[userId]?.[recent.pigId]?.copies,
    state.pig_progress?.[userId]?.[recent.pigId]?.growth_bonus
  )) : null
  return {
    user_id: userId,
    display_name: liveNames[userId] || state.user_names?.[userId] || '',
    daily_pig_id: dailyPigId,
    daily_pig_name: dailyPig?.name || '',
    daily_ex_level: dailyPigId ? level : null,
    daily_image_name: appearance?.imagePath || '',
    daily_achieved_at: state.snapshots?.[date]?.[userId]?.created_at || '',
    catalog_count: catalogCount(state, userId, map),
    catalog_achieved_at: '',
    recent_pig_id: recent?.pigId || '',
    recent_pig_name: recentPigEntry?.name || '',
    recent_image_name: recentAppearance?.imagePath || ''
  }
}

/**
 * 装配一个群的日报；返回 { report, unconfirmed }。
 * 不写保护、不改状态，查卡与定时推送共用。
 */
export const loadGroupReport = async ({ groupId, date, cutoffIso, officialPigs, botUserIds = [] }) => {
  const state = getState()
  const gid = String(groupId)
  const rawRolls = state.group_rolls?.[date]?.[gid] || {}
  const groupRolls = {}
  for (const [uid, entry] of Object.entries(rawRolls)) {
    if (!entry || typeof entry !== 'object') continue
    if (!beforeCutoff(entry.seen_at, cutoffIso)) continue
    if (entry.pig_id) groupRolls[uid] = String(entry.pig_id)
  }
  const activeMap = state.group_active?.[date]?.[gid] || {}
  const activeUserIds = Object.keys(activeMap).filter(uid => beforeCutoff(activeMap[uid], cutoffIso))
  const rawEvents = queryEvents({ date, groupId: gid, cutoffIso })

  const botIds = new Set((botUserIds || []).map(String))
  const liveNames = await loadMemberNames(gid)
  const participants = new Set([
    ...Object.keys(groupRolls),
    ...activeUserIds,
    ...rawEvents.flatMap(event => [
      event.attacker, event.target, event.backfire_victim_id,
      ...(event.participant_ids || []), ...(event.backfire_victim_ids || [])
    ]).map(String)
  ].filter(id => id && !botIds.has(id)))

  const map = new Map(mergedPigs(officialPigs).map(pig => [String(pig.id), pig]))
  const profiles = {}
  for (const userId of participants) {
    profiles[userId] = buildProfile({ state, userId, date, groupRolls, map, liveNames })
  }

  const protectDate = addDays(date, 1)
  const settled = hasSettlement(date, gid)
  const counts = countRoastedUsers(rawEvents)
  const protections = protectedUserIds(protectDate, gid).map(userId => {
    const entry = getProtectionEntry(protectDate, gid, userId)
    return {
      user_id: userId,
      display_name: liveNames[userId] || state.user_names?.[userId] || profiles[userId]?.display_name || userId,
      base_level: entry?.level || 1,
      roast_count: counts.get(String(userId)) || 0
    }
  }).filter(item => item.base_level > 0)
  const candidates = topRoastedUser(rawEvents, 2)
  const unconfirmed = Boolean(candidates && !settled)

  const report = buildDailyReport({
    date,
    groupId: gid,
    groupRolls,
    rawEvents,
    activeUserIds,
    botUserIds: [...botIds],
    profiles,
    protections,
    humanPigIds: [...loadPigRules().human],
    cutoffIso
  })
  // 图鉴排行用的 map 只在装配期使用；挂到报告上供视图取头像/名称，不写入 JSON。
  report.officialPigs = officialPigs
  report.unconfirmed_protection = unconfirmed
  return { report, unconfirmed }
}

export const reportActiveGroups = date => {
  const state = getState()
  const groups = new Set()
  for (const [gid, map] of Object.entries(state.group_rolls?.[date] || {})) {
    if (map && typeof map === 'object' && Object.keys(map).length) groups.add(gid)
  }
  for (const event of state.events?.[date] || []) {
    if (event?.group_id) groups.add(String(event.group_id))
  }
  return [...groups].filter(Boolean)
}

export const groupEventsForReport = ({ date, groupId, cutoffIso }) =>
  queryEvents({ date, groupId, cutoffIso })
