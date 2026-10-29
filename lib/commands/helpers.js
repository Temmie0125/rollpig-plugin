// 命令层共用：群上下文、显示名、目标解析、消息 ID、按钮。
import { segment } from 'oicq'
import fs from 'fs'
import path from 'path'
import { fileURLToPath, pathToFileURL } from 'url'
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

/**
 * 本地图片转消息段。用 base64 而不是 file:// URL：
 * QQBot 发送 Markdown 图片时会先把消息段换成可公开访问的 URL，
 * 而它的本地文件探测在 Windows 下解析不了 file:///E:/... （会退化成 file:// 链接导致图片不显示）。
 */
export const imageSegment = file => {
  if (!file) return null
  let source = file
  if (typeof source === 'string' && source.startsWith('file://')) {
    try {
      source = fileURLToPath(source)
    } catch {}
  }
  if (typeof source === 'string' && !/^(https?:|base64:)/i.test(source)) {
    try {
      return segment.image(`base64://${fs.readFileSync(source).toString('base64')}`, path.basename(source))
    } catch (error) {
      ;(globalThis.logger || console).warn?.(`[今天是什么小猪] 图片读取失败 ${source}:`, error)
    }
  }
  return segment.image(source)
}

export const pigImageSegment = imageSegment

export const atSegment = userId => segment.at(userId)

/** 群聊回复的 @ 前缀数组；私聊等其他场景返回空数组，方便直接展开进消息数组 */
export const atPrefix = e => (groupContext(e).isGroup && e?.user_id ? [atSegment(e.user_id)] : [])

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

/**
 * 抽猪 / 烤猪结果消息：群聊开头 @ 发起人；官方 QQBot 且开启 Markdown 时用粗体标题 + 引用块。
 * 图片缺失时仍保留 @ 与 Markdown 排版——之前一旦找不到图片就整体降级成纯文本，
 * 导致 Markdown 和 @ 一起消失。
 */
export const pigResultMessage = (plugin, e, {
  hint = '',
  title = '',
  description = '',
  analysis = '',
  imagePath = null,
  extras = [],
  button = null
} = {}) => {
  const parts = [...atPrefix(e)]
  const hintText = String(hint || '').replace(/\s+$/, '')
  if (hintText) parts.push(`\n${hintText}\n`)
  const image = imageSegment(imagePath)
  if (image) parts.push(image)
  const descriptionText = String(description || '')
  const analysisText = String(analysis || '')
  const markdown = Boolean(plugin?.config?.markdown) && isQQBot(e)
  if (markdown) {
    const quote = analysisText.split('\n').map(line => `> ${line}`).join('\n')
    parts.push(`\n**【${title}】**\n${descriptionText}${analysisText ? `\n${quote}` : ''}`)
  } else {
    parts.push(`\n【${title}】\n${descriptionText}${analysisText ? `\n\n${analysisText}` : ''}`)
  }
  for (const extra of extras) if (extra) parts.push(extra)
  // 按钮只在 Markdown 模式下附加：非 QQBot 平台对 button 段支持不一，保持旧版普通图片回复的样式
  if (button && markdown) parts.push(button)
  return parts.filter(Boolean)
}

export const fileUrl = file => pathToFileURL(path.resolve(file)).href
