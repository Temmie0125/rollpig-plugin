// 次日保护券：前一天在本群被烤次数最多且 >=2 的人，次日获得保护。
// 首日 Lv.3，连续受保护每日 +1，最高 Lv.5；当天被成功烤成时临时 +1（不继承）。
import { mutateState, getState } from '../state.js'
import { addDays, nowIso, todayStr } from '../time.js'
import { topRoastedUser } from './events.js'

export const protectionRequired = level => Math.min(5, Math.max(1, Math.trunc(Number(level) || 0))) + 1

export const getProtectionEntry = (date, groupId, userId) => {
  const state = getState()
  const ids = state.protected?.[date]?.[String(groupId)] || []
  if (!ids.includes(String(userId))) return null
  const detail = state.protection_details?.[date]?.[String(groupId)]?.[String(userId)] || {}
  const baseLevel = Math.min(5, Math.max(1, Math.trunc(Number(detail.base_level) || 1)))
  const successOffset = Math.max(0, Math.trunc(Number(detail.success_offset) || 0))
  return {
    baseLevel,
    successOffset,
    level: Math.min(5, baseLevel + successOffset),
    consecutiveDays: Math.max(0, Math.trunc(Number(detail.consecutive_days) || 0))
  }
}

export const isProtected = (date, groupId, userId) => {
  const ids = getState().protected?.[date]?.[String(groupId)] || []
  return ids.includes(String(userId))
}

export const protectionLevel = (date, groupId, userId) => getProtectionEntry(date, groupId, userId)?.level || 0

export const protectedUserIds = (date, groupId) => [...(getState().protected?.[date]?.[String(groupId)] || [])]

const settleInState = (state, { date, groupId, events, cutoffIso = '' }) => {
  const gid = String(groupId)
  state.settlements ||= {}
  state.settlements[date] ||= {}
  const existing = state.settlements[date][gid]
  if (existing) return { ...existing, already: true }

  const protectDate = addDays(date, 1)
  const top = topRoastedUser(events, 2)
  state.protected ||= {}
  state.protected[protectDate] ||= {}
  state.protection_details ||= {}
  state.protection_details[protectDate] ||= {}
  state.protection_details[protectDate][gid] ||= {}

  let protectedIds = []
  if (top) {
    const previousIds = state.protected?.[date]?.[gid] || []
    const previousDetail = state.protection_details?.[date]?.[gid]?.[top.userId] || {}
    const previousDays = previousIds.includes(top.userId)
      ? Math.max(0, Math.trunc(Number(previousDetail.consecutive_days) || 0))
      : 0
    const days = previousDays ? previousDays + 1 : 1
    const baseLevel = Math.min(5, 2 + days)
    state.protected[protectDate][gid] = [top.userId]
    state.protection_details[protectDate][gid][top.userId] = {
      base_level: baseLevel,
      consecutive_days: days,
      success_offset: 0,
      source: 'daily'
    }
    protectedIds = [top.userId]
  } else {
    state.protected[protectDate][gid] = []
  }

  const settlement = {
    date,
    group_id: gid,
    protect_date: protectDate,
    protected_ids: protectedIds,
    cutoff_at: cutoffIso,
    settled_at: nowIso()
  }
  state.settlements[date][gid] = settlement
  return settlement
}

/** 单个群结算；幂等，重复调用返回第一次的结果 */
export const settleGroupProtection = async ({ date, groupId, events, cutoffIso = '' }) =>
  mutateState(state => settleInState(state, { date, groupId, events, cutoffIso }))

/** 一次事务结算多个群，避免每个群重复写整个 state.json */
export const settleProtections = async ({ date, groups, eventsByGroup, cutoffIso = '' }) =>
  mutateState(state => {
    const result = {}
    for (const groupId of groups || []) {
      result[String(groupId)] = settleInState(state, {
        date,
        groupId,
        events: eventsByGroup?.[String(groupId)] || [],
        cutoffIso
      })
    }
    return result
  })

export const hasSettlement = (date, groupId) => Boolean(getState().settlements?.[date]?.[String(groupId)])

export const settlementFor = (date, groupId) => getState().settlements?.[date]?.[String(groupId)] || null

/** 保护目标被成功烤成时，本群当日保护等级 +1（最高 5） */
export const raiseProtectionOnSuccess = async ({ date, groupId, userId }) => mutateState(state => {
  const gid = String(groupId)
  const uid = String(userId)
  const ids = state.protected?.[date]?.[gid] || []
  if (!ids.includes(uid)) return { changed: false, level: 0 }
  const detail = state.protection_details?.[date]?.[gid]?.[uid] || {
    base_level: 3,
    consecutive_days: 1,
    success_offset: 0
  }
  const baseLevel = Math.min(5, Math.max(1, Math.trunc(Number(detail.base_level) || 1)))
  const offset = Math.max(0, Math.trunc(Number(detail.success_offset) || 0))
  const before = Math.min(5, baseLevel + offset)
  const after = Math.min(5, before + 1)
  detail.success_offset = Math.min(5, offset + (after > before ? 1 : 0))
  detail.base_level = baseLevel
  detail.consecutive_days = Math.max(1, Math.trunc(Number(detail.consecutive_days) || 1))
  detail.source = detail.source || 'daily'
  state.protection_details[date][gid][uid] = detail
  state.protected[date][gid] = ids
  return { changed: after > before, before, level: after }
})

/** 当前保护等级（用于聚众门槛/日报券） */
export const couponEntry = (date, groupId, userId) => {
  const entry = getProtectionEntry(date, groupId, userId)
  if (!entry) return null
  return {
    user_id: String(userId),
    base_level: entry.baseLevel,
    level: entry.level,
    consecutive_days: entry.consecutiveDays
  }
}

export const todayProtectionLevel = (groupId, userId) => protectionLevel(todayStr(), groupId, userId)
