// 命令层共用：群上下文、显示名、目标解析、消息 ID、按钮。
import { segment } from 'oicq'
import path from 'path'
import { pathToFileURL } from 'url'
import { getState, mutateState } from '../state.js'
import { touchGroupActive } from '../daily.js'
import { todayStr } from '../time.js'

export const isQQBot = e => {
  const platform = String(e?.platform || '')
  return platform.startsWith('QQ') || platform.startsWith('guild')
}

export const botIds = () => {
  const ids = new Set()
  for (const id of globalThis.Bot?.uin || []) ids.add(String(id))
  for (const id of Object.keys(globalThis.Bot?.bots || {})) ids.add(String(id))
  return [...ids]
}

export const userName = (e, userId = e?.user_id) => {
  const uid = String(userId)
  if (String(e?.user_id) === uid && (e?.sender?.card || e?.sender?.nickname)) {
    return String(e.sender.card || e.sender.nickname)
  }
  for (const members of globalThis.Bot?.gml?.values?.() || []) {
    const member = members?.get?.(Number(uid)) || members?.get?.(uid)
    if (member?.card || member?.nickname) return String(member.card || member.nickname)
  }
  try {
    const member = e?.group?.pickMember?.(Number(uid)) || e?.group?.pickMember?.(uid)
    if (member?.card || member?.nickname) return String(member.card || member.nickname)
  } catch {}
  const friend = globalThis.Bot?.fl?.get?.(Number(uid)) || globalThis.Bot?.fl?.get?.(uid)
  if (friend?.nickname || friend?.remark) return String(friend.nickname || friend.remark)
  return getState().user_names?.[uid] || String(userId || '')
}

export const groupContext = e => {
  const groupId = String(e?.group_id || e?.group?.group_id || '')
  return { isGroup: Boolean(groupId || e?.isGroup || e?.group), groupId }
}

export const touchContext = async (e, userId = e?.user_id, name = '') => {
  const { groupId } = groupContext(e)
  const uid = String(userId)
  if (groupId && uid) {
    await touchGroupActive(todayStr(), groupId, uid, name || userName(e, uid))
  } else if (name && uid) {
    await mutateState(state => {
      state.user_names ||= {}
      state.user_names[uid] = String(name)
    })
  }
}

export const messageIdOf = result => {
  if (!result) return ''
  if (typeof result === 'string') return result
  return String(result.message_id || result.data?.message_id || result.seq || '')
}

export const imageSegment = file => segment.image(pathToFileURL(file).href)

export const pigImageSegment = file => segment.image(pathToFileURL(file).href)

export const atSegment = userId => segment.at(userId)

export const buttons = list => {
  if (typeof segment.button !== 'function') return null
  return segment.button(list)
}

const atList = e => (Array.isArray(e?.message) ? e.message : [])
  .filter(item => item?.type === 'at')
  .map(item => String(item.qq))

export const resolveTarget = async e => {
  if (e?.atAll || atList(e).includes('all')) return { error: '一次只能烤一个目标，别把全群都@上。' }
  const selfId = String(e?.self_id || '')
  const unique = [...new Set(atList(e).filter(Boolean))]
  const nonBot = unique.filter(id => id !== selfId)
  if (nonBot.length > 1) return { error: '一次只能烤一个目标。' }
  if (nonBot.length === 1) {
    const target = nonBot[0]
    return { targetId: target, isBot: false }
  }
  if (unique.includes(selfId)) return { targetId: selfId, isBot: true }
  if (e?.at) {
    const target = String(e.at)
    return target === selfId ? { targetId: selfId, isBot: true } : { targetId: target, isBot: false }
  }
  if (e?.atBot) return { targetId: selfId, isBot: true }
  if (e?.reply_id) {
    try {
      const replied = typeof e.getReply === 'function' ? await e.getReply() : e.source
      const target = String(replied?.sender?.user_id || replied?.user_id || '')
      if (target) return { targetId: target, isBot: target === selfId }
    } catch (error) {
      return { error: `读取被回复的消息失败：${error?.message || error}` }
    }
  }
  return { error: '请 At 或回复你要烤的群友！' }
}

export const isGroupMember = (e, userId) => {
  const uid = String(userId)
  if (!uid) return false
  const gid = String(e?.group_id || e?.group?.group_id || '')
  const cache = globalThis.Bot?.gml?.get?.(Number(gid)) || globalThis.Bot?.gml?.get?.(gid)
  if (cache && cache.size) return Boolean(cache.get(Number(uid)) || cache.get(uid))
  try {
    const member = e?.group?.pickMember?.(Number(uid)) || e?.group?.pickMember?.(uid)
    return Boolean(member)
  } catch {
    return false
  }
}

export const isMaster = e => Boolean(e?.isMaster)

export const isGroupManager = e => Boolean(
  e?.isMaster || ['owner', 'admin'].includes(String(e?.sender?.role || ''))
)

export const roleWeight = e => (e?.isMaster || ['owner', 'admin'].includes(String(e?.sender?.role || '')) ? 2 : 1)

export const groupMemberRole = (groupId, userId) => {
  const cache = globalThis.Bot?.gml?.get?.(Number(groupId)) || globalThis.Bot?.gml?.get?.(groupId)
  const member = cache?.get?.(Number(userId)) || cache?.get?.(userId)
  return String(member?.role || '')
}

export const drawButtons = () => buttons([
  { text: '👑 猪圈', input: '#猪圈' },
  { text: '🐷 今日猪猪', input: '#今日猪猪' },
  { text: '📖 昨日小猪', input: '#昨日小猪' }
])

export const penButtons = () => buttons([
  { text: '🐷 今日猪猪', input: '#今日猪猪' },
  { text: '📖 我的猪圈', input: '#我的猪圈' },
  { text: '🔥 今日烤猪', input: '#今日烤猪' }
])

export const fileUrl = file => pathToFileURL(path.resolve(file)).href
