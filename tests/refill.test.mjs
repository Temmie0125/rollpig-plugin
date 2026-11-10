// 烤箱续火状态机：重复投票、超时通知的锚点路由与投递。
// state.js 在模块加载时就定下 DATA_DIR，所以必须先设环境变量再动态 import，绝不能写到生产 data/。
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rollpig-refill-'))
process.env.ROLLPIG_DATA_DIR = dataDir

const refill = await import('../lib/roast/refill.js')
const { ensureState, getState, mutateState } = await import('../lib/state.js')
const { todayStr } = await import('../lib/time.js')

ensureState()
test.after(() => {
  delete globalThis.Bot
  fs.rmSync(dataDir, { recursive: true, force: true })
})

const BOT_ID = '10001'
const MEMBERS = ['u1', 'u2', 'u3', 'u4']
const noticeOf = requestId => getState().refills[requestId].expiry_notice

const createVote = async (groupId, botId = '') => {
  const date = todayStr()
  await mutateState(state => {
    state.group_active[date] ||= {}
    state.group_active[date][groupId] = Object.fromEntries(MEMBERS.map(uid => [uid, { name: uid }]))
  })
  const created = await refill.createRefillRequest({
    groupId,
    initiatorId: 'u1',
    initiatorName: '发起人',
    botId
  })
  assert.equal(created.status, 'created')
  return created.request
}

/** 造一轮已超时、通知待发的投票；agoMs 为超时后经过的时间 */
const createExpiredVote = async (groupId, { botId = '', agoMs = 1000 } = {}) => {
  const request = await createVote(groupId, botId)
  await mutateState(state => {
    state.refills[request.request_id].expires_at = new Date(Date.now() - agoMs).toISOString()
  })
  assert.equal(await refill.expireRefills(), 1)
  assert.equal(noticeOf(request.request_id), 'pending')
  return request
}

/** 官方QQBot 的最小替身：adapter.id 用于识别平台，_passiveAnchor 是适配器记录的群内最近消息 */
const installOfficialBot = (groupId, { anchorAgeMs = null, sendResult = { message_id: ['sent'] } } = {}) => {
  const sent = []
  const openid = groupId.split(':')[1]
  const bot = {
    adapter: { id: 'QQBot' },
    gl: new Map([[groupId, {}]]),
    _passiveAnchor: anchorAgeMs === null ? {} : { [`group:${openid}`]: { id: 'msg', time: Date.now() - anchorAgeMs } }
  }
  globalThis.Bot = {
    bots: { [BOT_ID]: bot },
    pickGroup: () => ({ sendMsg: async msg => { sent.push(msg); return sendResult } })
  }
  return { bot, sent, openid }
}

test('重复投票只标记 duplicate，不改变票数；权重升级不算重复', async () => {
  const request = await createVote('g-duplicate')
  const vote = (userId, weight = 1) => refill.voteRefill({ requestId: request.request_id, userId, weight })

  const first = await vote('u2')
  assert.equal(first.status, 'pending')
  assert.equal(first.duplicate, false)
  assert.equal(first.request.vote_count, 1)

  const repeat = await vote('u2')
  assert.equal(repeat.status, 'pending')
  assert.equal(repeat.duplicate, true)
  assert.equal(repeat.request.vote_count, 1)

  // 同一人后来以管理员权重再投：1 头升 2 头，是有效变化；但只有 1 人参与，仍未达标
  const upgraded = await vote('u2', 2)
  assert.equal(upgraded.status, 'pending')
  assert.equal(upgraded.duplicate, false)
  assert.equal(upgraded.request.vote_count, 2)

  const settled = await vote('u3')
  assert.equal(settled.status, 'succeeded')
  assert.equal(settled.votes, 3)
})

test('投票时发现已超时：置为 expired 并挂起超时通知', async () => {
  const request = await createVote('g-vote-expired')
  await mutateState(state => {
    state.refills[request.request_id].expires_at = new Date(Date.now() - 1000).toISOString()
  })
  const result = await refill.voteRefill({ requestId: request.request_id, userId: 'u2' })
  assert.equal(result.status, 'expired')
  assert.equal(result.already_settled, undefined)
  assert.equal(noticeOf(request.request_id), 'pending')
})

test('官方Bot无任何锚点：不发送、不占用，保持 pending 等下一条群消息', async () => {
  const groupId = `${BOT_ID}:OPENID_WAIT`
  const request = await createExpiredVote(groupId, { botId: BOT_ID })
  const { bot, sent, openid } = installOfficialBot(groupId)

  assert.equal(await refill.deliverRefillExpiryNotices({ groupId }), 0)
  assert.equal(sent.length, 0)
  assert.equal(noticeOf(request.request_id), 'pending')

  // 锚点过了被动回复窗口同样不能用
  bot._passiveAnchor[`group:${openid}`] = { id: 'old', time: Date.now() - 300 * 1000 }
  assert.equal(await refill.deliverRefillExpiryNotices({ groupId }), 0)
  assert.equal(sent.length, 0)

  // 群里来了新消息，适配器刷新锚点 → 下一轮投递发出
  bot._passiveAnchor[`group:${openid}`] = { id: 'fresh', time: Date.now() }
  assert.equal(await refill.deliverRefillExpiryNotices({ groupId }), 1)
  assert.equal(sent.length, 1)
  assert.match(sent[0], /续火/)
  assert.match(sent[0], /0 \/ 2/)
  assert.equal(noticeOf(request.request_id), 'sent')

  // 已发出的不会重发
  assert.equal(await refill.deliverRefillExpiryNotices({ groupId }), 0)
  assert.equal(sent.length, 1)
})

test('事件锚点（按钮回调的 reply）优先于适配器锚点', async () => {
  const groupId = `${BOT_ID}:OPENID_EVENT`
  const request = await createExpiredVote(groupId, { botId: BOT_ID })
  const { sent } = installOfficialBot(groupId)
  const replied = []
  refill.rememberRefillAnchor(groupId, async msg => {
    replied.push(msg)
    // QQBot 适配器重试成功时 error 与 message_id 并存，仍算发送成功
    return { error: [new Error('首次失败')], message_id: ['retry-ok'] }
  })

  assert.equal(await refill.deliverRefillExpiryNotices({ groupId }), 1)
  assert.equal(replied.length, 1)
  assert.equal(sent.length, 0)
  assert.equal(noticeOf(request.request_id), 'sent')
})

test('事件锚点发送失败：有适配器锚点则接力，没有则回退 pending 且不计失败次数', async () => {
  const waitGroup = `${BOT_ID}:OPENID_FALLBACK_WAIT`
  const waiting = await createExpiredVote(waitGroup, { botId: BOT_ID })
  const { sent: waitSent } = installOfficialBot(waitGroup)
  refill.rememberRefillAnchor(waitGroup, async () => ({ error: [new Error('event_id 失效')] }))
  assert.equal(await refill.deliverRefillExpiryNotices({ groupId: waitGroup }), 0)
  assert.equal(waitSent.length, 0)
  assert.equal(noticeOf(waiting.request_id), 'pending')
  assert.equal(getState().refills[waiting.request_id].expiry_notice_attempts, undefined)

  const relayGroup = `${BOT_ID}:OPENID_FALLBACK_RELAY`
  const relayed = await createExpiredVote(relayGroup, { botId: BOT_ID })
  const { sent: relaySent } = installOfficialBot(relayGroup, { anchorAgeMs: 1000 })
  refill.rememberRefillAnchor(relayGroup, async () => ({ error: [new Error('event_id 失效')] }))
  assert.equal(await refill.deliverRefillExpiryNotices({ groupId: relayGroup }), 1)
  assert.equal(relaySent.length, 1)
  assert.equal(noticeOf(relayed.request_id), 'sent')
})

test('非官方平台没有被动回复限制：直接群发', async () => {
  const request = await createExpiredVote('123456')
  const sent = []
  globalThis.Bot = {
    bots: { 20002: { adapter: { id: 'OneBotv11' } } },
    pickGroup: () => ({ sendMsg: async msg => { sent.push(msg); return { message_id: 1 } } })
  }
  assert.equal(await refill.deliverRefillExpiryNotices({ groupId: '123456' }), 1)
  assert.equal(sent.length, 1)
  assert.equal(noticeOf(request.request_id), 'sent')
})

test('发送连续失败 3 次后放弃', async () => {
  const groupId = `${BOT_ID}:OPENID_FAIL`
  const request = await createExpiredVote(groupId, { botId: BOT_ID })
  const { sent } = installOfficialBot(groupId, { anchorAgeMs: 1000, sendResult: { message_id: [], error: [new Error('boom')] } })

  for (const expected of ['pending', 'pending', 'dropped']) {
    assert.equal(await refill.deliverRefillExpiryNotices({ groupId }), 0)
    assert.equal(noticeOf(request.request_id), expected)
  }
  assert.equal(sent.length, 3)
  assert.equal(getState().refills[request.request_id].expiry_notice_attempts, 3)
  assert.equal(await refill.deliverRefillExpiryNotices({ groupId }), 0)
  assert.equal(sent.length, 3)
})

test('超时太久的通知直接作废', async () => {
  const groupId = `${BOT_ID}:OPENID_TTL`
  const request = await createExpiredVote(groupId, { botId: BOT_ID, agoMs: 31 * 60 * 1000 })
  const { sent } = installOfficialBot(groupId, { anchorAgeMs: 1000 })
  assert.equal(await refill.deliverRefillExpiryNotices({ groupId }), 0)
  assert.equal(sent.length, 0)
  assert.equal(noticeOf(request.request_id), 'dropped')
})

test('新一轮发起后，上一轮未发出的超时通知作废', async () => {
  const groupId = `${BOT_ID}:OPENID_SUPERSEDED`
  const stale = await createExpiredVote(groupId, { botId: BOT_ID })
  const next = await refill.createRefillRequest({ groupId, initiatorId: 'u1', initiatorName: '发起人', botId: BOT_ID })
  assert.equal(next.status, 'created')
  assert.equal(noticeOf(stale.request_id), 'dropped')
  assert.equal(next.request.message_bot_id, BOT_ID)
})

test('并发投递同一条通知只发一次', async () => {
  const groupId = `${BOT_ID}:OPENID_RACE`
  const request = await createExpiredVote(groupId, { botId: BOT_ID })
  const { sent } = installOfficialBot(groupId, { anchorAgeMs: 1000 })
  const results = await Promise.all([
    refill.deliverRefillExpiryNotices({ groupId }),
    refill.deliverRefillExpiryNotices({ groupId }),
    refill.deliverRefillExpiryNotices({ groupId })
  ])
  assert.equal(results.reduce((sum, count) => sum + count, 0), 1)
  assert.equal(sent.length, 1)
  assert.equal(noticeOf(request.request_id), 'sent')
})
