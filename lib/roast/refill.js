// 烤箱续火：10 分钟群体投票，双模式计票（表情回应 notice / 回复「续火」）。
import crypto from 'crypto'
import path from 'path'
import { fileURLToPath } from 'url'
import { getState, mutateState } from '../state.js'
import { nowIso, todayStr } from '../time.js'
import { formatText, pickText, texts } from '../texts.js'
import { normalizeChargeSettings } from './charges.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const REFILL_IMAGE_PATH = path.resolve(__dirname, '..', '..', 'resource', 'refill.jpg')
export const REFILL_EMOJI_ID = '424'
export const REFILL_DURATION_MS = 10 * 60 * 1000
export const REFILL_MIN_ACTIVE = 3
export const REFILL_MIN_DISTINCT_VOTERS = 2
const THRESHOLD_STEPS = [[25, 8], [35, 12], [45, 16], [55, 20]]
const log = () => globalThis.logger || console

// 超时通知：官方QQBot群聊只能被动回复，msg_id/event_id 有效期 5 分钟，
// 留 30s 余量（与 QQBot-Adapter 的 fixPassiveSource 一致）。
const REPLY_ANCHOR_TTL_MS = 270 * 1000
const EXPIRY_NOTICE_TTL_MS = 30 * 60 * 1000
const EXPIRY_NOTICE_MAX_ATTEMPTS = 3

// 适配器只把普通群消息记作被动回复锚点，按钮回调不算；而投票期间的互动几乎全是回调。
// 这里按群补记最近一次续火相关事件的 reply（回调走 event_id，同样可被动回复）。
const replyAnchors = new Map()

export const rememberRefillAnchor = (groupId, reply) => {
  if (!groupId || typeof reply !== 'function') return
  replyAnchors.set(String(groupId), { reply, time: Date.now() })
}

const freshAnchor = groupId => {
  const anchor = replyAnchors.get(String(groupId))
  if (!anchor) return null
  if (Date.now() - anchor.time > REPLY_ANCHOR_TTL_MS) {
    replyAnchors.delete(String(groupId))
    return null
  }
  return anchor
}

/** 官方QQBot 的 bot 实例（无事件上下文时用于探询适配器锚点）；其他平台返回 null */
const officialBotOf = request => {
  const root = globalThis.Bot
  const botId = String(request.message_bot_id || '')
  const byId = botId ? (root?.bots?.[botId] || root?.[botId]) : null
  const candidates = byId ? [byId] : Object.values(root?.bots || {})
  return candidates.find(bot =>
    String(bot?.adapter?.id || '') === 'QQBot' && (byId || bot?.gl?.has?.(String(request.group_id)))
  ) || null
}

/** 适配器记录的群内最近一条普通消息是否仍在被动回复窗口内 */
const adapterAnchorFresh = (bot, groupId) => {
  const openid = String(groupId).split(':').slice(1).join(':')
  const anchor = bot?._passiveAnchor?.[`group:${openid}`]
  return Boolean(anchor?.id) && Date.now() - Number(anchor.time || 0) < REPLY_ANCHOR_TTL_MS
}

// QQBot 适配器发送失败不抛错而是塞进 error 数组；重试成功时 error 与 message_id 会同时存在
const sendFailed = result => Boolean(result?.error?.length) &&
  !(Array.isArray(result.message_id) ? result.message_id.length : result.message_id)

export const refillThreshold = (activeCount, successCount) => {
  const active = Math.max(0, Math.trunc(Number(activeCount) || 0))
  const success = Math.max(0, Math.trunc(Number(successCount) || 0))
  const [ratio, cap] = THRESHOLD_STEPS[Math.min(success, THRESHOLD_STEPS.length - 1)]
  const required = Math.max(2, Math.min(Math.ceil(active * ratio / 100), cap))
  return { ratio, required }
}

const groupActiveIds = (state, date, groupId, excludeIds = []) => {
  const excluded = new Set((excludeIds || []).map(String))
  const active = state.group_active?.[date]?.[String(groupId)]
  const rolls = state.group_rolls?.[date]?.[String(groupId)]
  const ids = new Set([
    ...Object.keys(active && typeof active === 'object' ? active : {}),
    ...Object.keys(rolls && typeof rolls === 'object' ? rolls : {})
  ])
  return [...ids].filter(id => !excluded.has(id))
}

const successCount = (state, date, groupId) =>
  Object.values(state.refills || {}).filter(item =>
    item && item.date === date && item.group_id === String(groupId) && item.status === 'succeeded'
  ).length

const activeRequest = (state, date, groupId) =>
  Object.values(state.refills || {}).find(item =>
    item && item.date === date && item.group_id === String(groupId) && item.status === 'active'
  ) || null

const view = request => {
  if (!request) return null
  const votes = request.votes && typeof request.votes === 'object' ? request.votes : {}
  const supporters = Object.keys(votes).length
  const voteCount = Object.values(votes).reduce((sum, weight) => sum + Math.max(1, Math.trunc(Number(weight) || 1)), 0)
  const remaining = Math.max(0, Math.ceil((Date.parse(request.expires_at) - Date.now()) / 60000))
  return { ...request, supporters, vote_count: voteCount, remaining_minutes: remaining }
}

export const getActiveRefill = (groupId, date = todayStr()) =>
  view(activeRequest(getState(), date, String(groupId)))

/** 发起续火；调用方负责发送投票消息并把 message_id 绑定回来 */
export const createRefillRequest = async ({
  groupId,
  initiatorId,
  initiatorName,
  excludeIds = [],
  config = {},
  botId = '',
  date = todayStr()
}) => mutateState(state => {
  const gid = String(groupId)
  const uid = String(initiatorId)
  const existing = activeRequest(state, date, gid)
  if (existing) return { status: 'existing', request: view(existing) }
  const activeIds = groupActiveIds(state, date, gid, excludeIds)
  if (activeIds.length < REFILL_MIN_ACTIVE) {
    return { status: 'insufficient_active', activeCount: activeIds.length }
  }
  if (!activeIds.includes(uid)) return { status: 'inactive_initiator', activeCount: activeIds.length }
  const success = successCount(state, date, gid)
  const { required } = refillThreshold(activeIds.length, success)
  const { chargeMax } = normalizeChargeSettings({ config })
  // 新一轮发起后，上一轮压着没发出去的超时通知只会让人困惑
  for (const other of Object.values(state.refills || {})) {
    if (other && other.group_id === gid && other.date === date && other.expiry_notice === 'pending') {
      other.expiry_notice = 'dropped'
    }
  }
  const request = {
    request_id: crypto.randomUUID().replace(/-/g, ''),
    date,
    group_id: gid,
    initiator_id: uid,
    initiator_name: String(initiatorName || uid),
    active_user_ids: activeIds.map(String),
    active_count: activeIds.length,
    required_votes: required,
    votes: {},
    status: 'active',
    success_count_before: success,
    max_charges: chargeMax,
    created_at: nowIso(),
    expires_at: new Date(Date.now() + REFILL_DURATION_MS).toISOString(),
    message_id: '',
    message_bot_id: String(botId || ''),
    benefited_user_ids: []
  }
  state.refills ||= {}
  state.refills[request.request_id] = request
  return { status: 'created', request: view(request) }
})

export const bindRefillMessage = async (requestId, messageId, botId = '') => mutateState(state => {
  const request = state.refills?.[String(requestId)]
  if (!request) return false
  request.message_id = String(messageId || '')
  request.message_bot_id = String(botId || '')
  return true
})

export const findRefillByMessage = (messageId, groupId = '') => {
  const target = String(messageId || '')
  return view(Object.values(getState().refills || {}).find(item =>
    item && String(item.message_id || '') === target &&
    (!groupId || item.group_id === String(groupId))
  ) || null)
}

const succeedInState = (state, request) => {
  const now = Date.now() / 1000
  const benefited = (request.active_user_ids || []).map(String)
  state.usage ||= {}
  for (const uid of benefited) {
    const previous = state.usage[uid]
    const last = previous && typeof previous === 'object' ? previous.last_roast_ts : (previous || null)
    state.usage[uid] = {
      last_roast_ts: last,
      roast_charges: request.max_charges,
      roast_charge_updated_ts: now
    }
  }
  request.status = 'succeeded'
  request.completed_at = nowIso()
  request.benefited_user_ids = benefited
  request.benefited_count = benefited.length
  return {
    status: 'succeeded',
    request: view(request),
    benefited: benefited.length,
    votes: view(request).vote_count,
    supporters: view(request).supporters
  }
}

/**
 * 记一票；同一用户只计一次，管理员权重可从 1 升到 2。
 * weight: 1 普通成员，2 群主/管理员
 */
export const voteRefill = async ({
  requestId,
  userId,
  weight = 1,
  date = todayStr()
}) => mutateState(state => {
  const request = state.refills?.[String(requestId)]
  if (!request) return { status: 'not_found' }
  if (request.status !== 'active') {
    // already_settled：这是历史已结束的投票而非本次新达成的成功，
    // 调用方据此避免重复渲染成功文案（此时 votes/benefited 字段不存在）
    return { status: request.status, request: view(request), already_settled: true }
  }
  if (Date.parse(request.expires_at) <= Date.now()) {
    request.status = 'expired'
    request.expiry_notice = 'pending'
    return { status: 'expired', request: view(request) }
  }
  const uid = String(userId)
  if (!(request.active_user_ids || []).includes(uid)) return { status: 'not_eligible', request: view(request) }
  const previous = Math.trunc(Number(request.votes?.[uid]) || 0)
  const next = Math.max(previous, weight >= 2 ? 2 : 1)
  request.votes ||= {}
  request.votes[uid] = next
  const info = view(request)
  if (info.vote_count >= request.required_votes && info.supporters >= REFILL_MIN_DISTINCT_VOTERS) {
    return succeedInState(state, request)
  }
  // duplicate：同一成员的重复点击/回复，票数没有变化，调用方提示“已参与”而不是再播一遍进度
  return { status: 'pending', request: info, duplicate: next <= previous }
})

export const expireRefills = async () => {
  const hasExpired = Object.values(getState().refills || {}).some(request =>
    request?.status === 'active' && Date.parse(request.expires_at) <= Date.now()
  )
  if (!hasExpired) return 0
  return mutateState(state => {
    let expired = 0
    for (const request of Object.values(state.refills || {})) {
      if (!request || request.status !== 'active') continue
      if (Date.parse(request.expires_at) <= Date.now()) {
        request.status = 'expired'
        request.expiry_notice = 'pending'
        expired++
      }
    }
    return expired
  })
}

/** 再次执行「烤箱续火」时，如果票数已经达标但状态尚未推进，补一次结算 */
export const completeRefillIfReady = async requestId => mutateState(state => {
  const request = state.refills?.[String(requestId)]
  if (!request) return { status: 'not_found' }
  if (request.status !== 'active') {
    // already_settled：这是历史已结束的投票而非本次新达成的成功，
    // 调用方据此避免重复渲染成功文案（此时 votes/benefited 字段不存在）
    return { status: request.status, request: view(request), already_settled: true }
  }
  const info = view(request)
  if (info.vote_count >= request.required_votes && info.supporters >= REFILL_MIN_DISTINCT_VOTERS) {
    return succeedInState(state, request)
  }
  return { status: 'pending', request: info }
})

export const formatRefillCreated = (request, { replyEnabled = true, withButton = false } = {}) => {
  const base = formatText(pickText(texts.ROAST_REFILL_CREATED_TEXTS), {
    initiator: request.initiator_name || request.initiator_id,
    active_count: request.active_count,
    required_votes: request.required_votes,
    success_summary: request.success_count_before > 0 ? `\n今日已续火 ${request.success_count_before} 次。` : '',
    max_charges: request.max_charges,
    vote_rule: '管理及以上按 2 头计'
  })
  if (!replyEnabled) return base
  return withButton
    ? `${base}\n点击下方「续火投票」按钮即可参与；也可以回复本条消息发送「续火」。`
    : `${base}\n也可以回复本条消息发送「续火」参与投票。`
}

export const formatRefillExisting = request => {
  if (request.vote_count >= request.required_votes && request.supporters >= REFILL_MIN_DISTINCT_VOTERS) {
    return '续火支持已经达标，正在结算。'
  }
  const missingVotes = Math.max(0, request.required_votes - request.vote_count)
  const missingSupporters = Math.max(0, REFILL_MIN_DISTINCT_VOTERS - request.supporters)
  let hint = ''
  if (missingVotes && missingSupporters) hint = `，还差 ${missingVotes} 头，且至少再来 ${missingSupporters} 人`
  else if (missingVotes) hint = `，还差 ${missingVotes} 头`
  else if (missingSupporters) hint = `，至少再来 ${missingSupporters} 人`
  return formatText(pickText(texts.ROAST_REFILL_EXISTING_TEXTS), {
    current: request.vote_count,
    required: request.required_votes,
    requirement_hint: hint,
    minutes: request.remaining_minutes
  })
}

export const formatRefillSuccess = result => {
  const request = result.request
  return formatText(pickText(texts.ROAST_REFILL_SUCCESS_TEXTS), {
    votes: result.votes,
    benefited: result.benefited,
    success_count: (request.success_count_before || 0) + 1,
    max_charges: request.max_charges
  })
}

// 代码兜底：texts.json 漏提交（线上从 main 拉代码，resource 常漏）时 pickText 返回空串，
// 而超时通知一旦静默，看起来就像“超时没有提示”这个 bug 又回来了
const EXPIRED_FALLBACK =
  '⏳【续火超时】本轮续火投票已超时结束（{votes} / {required} 头），可再次发送「烤箱续火」重新发起。'

export const formatRefillExpired = request => {
  const info = view(request)
  return formatText(pickText(texts.ROAST_REFILL_EXPIRED_TEXTS) || EXPIRED_FALLBACK, {
    votes: info.vote_count,
    required: info.required_votes
  })
}

/** 官方Bot只有被动回复：事件锚点和适配器锚点都没有时发不出去，只能等群内下一条消息 */
const canDeliverNow = request => {
  if (freshAnchor(request.group_id)) return true
  const official = officialBotOf(request)
  return !official || adapterAnchorFresh(official, request.group_id)
}

/**
 * 发一条超时通知；返回 true=已发出，false=暂时没有可用锚点（保持 pending 等窗口），抛错=发送失败。
 * 先走插件事件锚点（按钮回调的 event_id，适配器锚点覆盖不到），失败再退到适配器/普通群发。
 */
const sendExpiryNotice = async request => {
  const text = formatRefillExpired(request)
  const anchor = freshAnchor(request.group_id)
  if (anchor) {
    const result = await anchor.reply(text)
    if (!sendFailed(result)) return true
    replyAnchors.delete(String(request.group_id))
    log().warn?.(`[烤箱续火] 事件锚点发送超时通知失败，改走适配器锚点: ${request.group_id}`)
  }
  // 官方Bot：适配器锚点也过期就别硬发主动消息了（无配额，白打 4 次重试），回退等新锚点
  const official = officialBotOf(request)
  if (official && !adapterAnchorFresh(official, request.group_id)) return false
  const group = globalThis.Bot?.pickGroup?.(Number(request.group_id) || request.group_id)
  if (!group?.sendMsg) throw new Error(`找不到群 ${request.group_id}`)
  const result = await group.sendMsg(text)
  if (sendFailed(result)) {
    throw new Error(String(result.error?.[0]?.message || result.error?.[0] || '发送失败'))
  }
  return true
}

const claimExpiryNotice = requestId => mutateState(state => {
  const request = state.refills?.[String(requestId)]
  if (!request || request.expiry_notice !== 'pending') return null
  request.expiry_notice = 'sending'
  return { ...request }
})

const settleExpiryNotice = (requestId, status, attempts) => mutateState(state => {
  const request = state.refills?.[String(requestId)]
  if (!request) return
  request.expiry_notice = status
  if (attempts !== undefined) request.expiry_notice_attempts = attempts
})

/**
 * 机会式投递续火超时通知：分钟轮询、到点定时器、群内新事件都会调用，可重复调用。
 * pending → sending（认领防并发重发）→ sent；无锚点时回退 pending 等下一条群消息；
 * 连续失败 EXPIRY_NOTICE_MAX_ATTEMPTS 次或超过 EXPIRY_NOTICE_TTL_MS 后放弃。
 */
export const deliverRefillExpiryNotices = async ({ groupId = '' } = {}) => {
  const pending = Object.values(getState().refills || {}).filter(item =>
    item && item.expiry_notice === 'pending' && (!groupId || item.group_id === String(groupId))
  )
  let sent = 0
  for (const item of pending) {
    if (Date.now() - Date.parse(item.expires_at) > EXPIRY_NOTICE_TTL_MS) {
      await settleExpiryNotice(item.request_id, 'dropped')
      continue
    }
    if (!canDeliverNow(item)) continue
    const request = await claimExpiryNotice(item.request_id)
    if (!request) continue
    try {
      if (await sendExpiryNotice(request)) {
        await settleExpiryNotice(request.request_id, 'sent')
        sent++
      } else {
        await settleExpiryNotice(request.request_id, 'pending')
      }
    } catch (error) {
      const attempts = Math.trunc(Number(request.expiry_notice_attempts) || 0) + 1
      log().warn?.(
        `[烤箱续火] 超时通知发送失败(${attempts}/${EXPIRY_NOTICE_MAX_ATTEMPTS}): ${request.group_id}`,
        error
      )
      await settleExpiryNotice(
        request.request_id,
        attempts >= EXPIRY_NOTICE_MAX_ATTEMPTS ? 'dropped' : 'pending',
        attempts
      )
    }
  }
  return sent
}

/**
 * 到点立即尝试投递：分钟轮询最多晚一分钟，而被动锚点只有约 270s，
 * 群刚好在锚点失效前后安静下来时，这几十秒就是能不能送达的分界。
 */
export const scheduleRefillExpiryNotice = request => {
  const delay = Date.parse(request.expires_at) - Date.now() + 1500
  if (!(delay > 0)) return
  const timer = setTimeout(async () => {
    try {
      await expireRefills()
      await deliverRefillExpiryNotices({ groupId: request.group_id })
    } catch (error) {
      log().warn?.('[烤箱续火] 到点超时处理失败:', error)
    }
  }, delay)
  timer.unref?.()
}

export const refillInsufficientText = () => pickText(texts.ROAST_REFILL_INSUFFICIENT_ACTIVE_TEXTS)
export const refillInactiveText = () => pickText(texts.ROAST_REFILL_INACTIVE_INITIATOR_TEXTS)
export const refillHintText = () => pickText(texts.ROAST_REFILL_REACTION_HINT_TEXTS)
export const refillUnsupportedText = () => pickText(texts.ROAST_REFILL_UNSUPPORTED_TEXTS)
