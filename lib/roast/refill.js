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
    message_bot_id: '',
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
  if (request.status !== 'active') return { status: request.status, request: view(request) }
  if (Date.parse(request.expires_at) <= Date.now()) {
    request.status = 'expired'
    return { status: 'expired', request: view(request) }
  }
  const uid = String(userId)
  if (!(request.active_user_ids || []).includes(uid)) return { status: 'not_eligible', request: view(request) }
  const current = Math.max(1, Math.trunc(Number(request.votes?.[uid]) || 0))
  const next = Math.max(current, weight >= 2 ? 2 : 1)
  request.votes ||= {}
  request.votes[uid] = next
  const info = view(request)
  if (info.vote_count >= request.required_votes && info.supporters >= REFILL_MIN_DISTINCT_VOTERS) {
    return succeedInState(state, request)
  }
  return { status: 'pending', request: info }
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
  if (request.status !== 'active') return { status: request.status, request: view(request) }
  const info = view(request)
  if (info.vote_count >= request.required_votes && info.supporters >= REFILL_MIN_DISTINCT_VOTERS) {
    return succeedInState(state, request)
  }
  return { status: 'pending', request: info }
})

export const formatRefillCreated = (request, { replyEnabled = true } = {}) => {
  const base = formatText(pickText(texts.ROAST_REFILL_CREATED_TEXTS), {
    initiator: request.initiator_name || request.initiator_id,
    active_count: request.active_count,
    required_votes: request.required_votes,
    success_summary: request.success_count_before > 0 ? `\n今日已续火 ${request.success_count_before} 次。` : '',
    max_charges: request.max_charges,
    vote_rule: '管理及以上按 2 头计'
  })
  return replyEnabled
    ? `${base}\n也可以回复本条消息发送「续火」参与投票。`
    : base
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

export const refillInsufficientText = () => pickText(texts.ROAST_REFILL_INSUFFICIENT_ACTIVE_TEXTS)
export const refillInactiveText = () => pickText(texts.ROAST_REFILL_INACTIVE_INITIATOR_TEXTS)
export const refillHintText = () => pickText(texts.ROAST_REFILL_REACTION_HINT_TEXTS)
export const refillUnsupportedText = () => pickText(texts.ROAST_REFILL_UNSUPPORTED_TEXTS)
