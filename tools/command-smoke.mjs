// 命令层烟雾测试：用假 e 对象跑今日小猪/烤群友/今日烤猪/续火/日报开关。
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PLUGIN_ROOT = path.resolve(__dirname, '..')
const SMOKE_DATA = path.join(PLUGIN_ROOT, '.smoke-data')
process.env.ROLLPIG_DATA_DIR = SMOKE_DATA
process.chdir(path.resolve(PLUGIN_ROOT, '../..'))
globalThis.logger = new Proxy(console, {
  get(target, prop) {
    if (prop in target) return target[prop]
    return (...args) => console.log(...args)
  }
})
const groupMessages = []
globalThis.Bot = {
  uin: ['999'],
  bots: {},
  gml: new Map(),
  fl: new Map(),
  pickGroup: () => ({ sendMsg: async msg => { groupMessages.push(msg); return { message_id: `g${groupMessages.length}` } } }),
  pickMember: () => ({})
}
fs.rmSync(SMOKE_DATA, { recursive: true, force: true })

const { RollPigPlugin } = await import('../index.js')
const { getOrCreateDailyRoll } = await import('../lib/daily.js')
const { todayStr, yesterdayStr } = await import('../lib/time.js')
const { getState } = await import('../lib/state.js')

const plugin = new RollPigPlugin()
const date = todayStr()
await getOrCreateDailyRoll({ userId: '1001', officialPigs: plugin.pigData, date, groupId: '2001' })
await getOrCreateDailyRoll({ userId: '1002', officialPigs: plugin.pigData, date, groupId: '2001' })
await getOrCreateDailyRoll({ userId: '1003', officialPigs: plugin.pigData, date, groupId: '2001' })

const makeE = (userId = '1001', extra = {}) => {
  const replies = []
  const e = {
    user_id: userId,
    group_id: '2001',
    self_id: '999',
    isGroup: true,
    platform: 'qq',
    sender: { card: `群友${userId}`, nickname: `群友${userId}`, role: 'member' },
    msg: '',
    message: [],
    reply: async msg => {
      replies.push(msg)
      return { message_id: `m${replies.length}` }
    },
    group: {
      pickMember: () => ({}),
      sendMsg: async () => ({ message_id: 'g1' })
    },
    ...extra
  }
  return { e, replies }
}

let fake = makeE('1001')
await plugin.todayPig(fake.e)
console.log('today replies', fake.replies.length, typeof fake.replies[0])
fake = makeE('1001')
await plugin.todayPig(fake.e)
console.log('today repeat replies', fake.replies.length, String(fake.replies[0]).slice(0, 20))

// 官方 QQBot + Markdown：群聊回复必须以 @ 开头，图片缺失时仍保留 Markdown（不再降级成纯文本）
plugin.config.markdown = true
fake = makeE('1001', { platform: 'QQ-group' })
await plugin.todayPig(fake.e)
const mdDraw = fake.replies[0]
const mdText = Array.isArray(mdDraw) ? mdDraw.filter(item => typeof item === 'string').join('') : String(mdDraw)
console.log('markdown draw', Array.isArray(mdDraw) && mdDraw[0]?.type === 'at' ? 'at-first' : 'no-at',
  mdText.includes('**【') ? 'bold-title' : 'no-bold',
  mdText.includes('> ') ? 'quote' : 'no-quote',
  Array.isArray(mdDraw) && mdDraw.some(item => item?.type === 'image') ? 'image' : 'no-image')
const { replyDraw } = await import('../lib/commands/daily.js')
fake = makeE('1001', { platform: 'QQ-group' })
await replyDraw(plugin, fake.e, {
  pig: { id: 'no-such-pig', name: '缺图猪' },
  appearance: { name: '缺图猪', description: '简述', analysis: '第一行\n第二行' },
  level: 0,
  hint: '缺图测试'
})
const missingImage = fake.replies[0]
console.log('markdown missing image', Array.isArray(missingImage) && missingImage[0]?.type === 'at' ? 'at-first' : 'no-at',
  missingImage.some(item => typeof item === 'string' && item.includes('**【缺图猪】**')) ? 'bold-title' : 'no-bold')
plugin.config.markdown = false

fake = makeE('1001', {
  msg: '烤群友',
  at: '1002',
  message: [{ type: 'at', qq: '1002' }, { type: 'text', text: '烤群友' }]
})
await plugin.memberRoast(fake.e)
console.log('member roast replies', fake.replies.length, fake.replies.map(item => Array.isArray(item) ? `array(${item.length})` : String(item).slice(0, 30)))

fake = makeE('1001', { msg: '今日烤猪', message: [{ type: 'text', text: '今日烤猪' }] })
await plugin.todayRoast(fake.e)
console.log('self roast replies', fake.replies.length, fake.replies.map(item => Array.isArray(item) ? `array(${item.length})` : String(item).slice(0, 30)))

// 官方 QQBot + Markdown 的今日烤猪同样要 @ 发起人并走 Markdown
// （随机猪可能本身就是熟食/人类形态，会走拦截文案，这里多试几个用户直到真正出结果）
plugin.config.markdown = true
let mdRoastResult = 'not-triggered'
for (const uid of ['1010', '1011', '1012', '1013', '1014', '1015']) {
  fake = makeE(uid, { platform: 'QQ-group', msg: '今日烤猪', message: [{ type: 'text', text: '今日烤猪' }] })
  await plugin.todayRoast(fake.e)
  const reply = fake.replies[0]
  if (!Array.isArray(reply) || !reply.some(item => item?.type === 'image')) continue
  const text = reply.filter(item => typeof item === 'string').join('')
  mdRoastResult = [
    reply[0]?.type === 'at' ? 'at-first' : 'no-at',
    text.includes('**【') ? 'bold-title' : 'no-bold',
    reply.some(item => item?.type === 'image') ? 'image' : 'no-image'
  ].join(' ')
  break
}
console.log('markdown roast', mdRoastResult)
plugin.config.markdown = false

fake = makeE('1001', { msg: '烤箱续火', message: [{ type: 'text', text: '烤箱续火' }] })
await plugin.refill(fake.e)
console.log('refill replies', fake.replies.length, fake.replies.map(item => Array.isArray(item) ? `array(${item.length})` : String(item).slice(0, 40)))
const refillRequest = Object.values(getState().refills || {})[0]
if (refillRequest) {
  for (const voter of ['1002', '1003']) {
    const voteE = makeE(voter, { msg: '续火', reply_id: refillRequest.message_id, message: [{ type: 'text', text: '续火' }] })
    await plugin.voteRefill(voteE.e)
    console.log('vote', voter, refillRequest.message_id, voteE.replies.map(item => String(item).slice(0, 50)))
  }
  console.log('refill status', Object.values(getState().refills || {})[0]?.status)
}

fake = makeE('1001', { msg: '小猪日报 开启', sender: { card: '群友1001', nickname: '群友1001', role: 'owner' } })
await plugin.reportSwitch(fake.e)
console.log('report switch replies', fake.replies.length, String(fake.replies[0]).slice(0, 60))
console.log('report enabled', getState().report_groups)

fake = makeE('1001', { msg: '小猪日报 状态', sender: { card: '群友1001', nickname: '群友1001', role: 'owner' } })
await plugin.reportSwitch(fake.e)
console.log('report status', String(fake.replies[0]).replace(/\n/g, ' | '))

// 昨日补签会走真实渲染器；这里只验证业务装配，不渲染图片。
const { ensureYesterdayPig } = await import('../lib/daily.js')
const { buildYesterdayRecap } = await import('../lib/yesterday.js')
await ensureYesterdayPig({ userId: '1001', officialPigs: plugin.pigData })
const recap = buildYesterdayRecap({ userId: '1001', groupId: '2001', date: yesterdayStr() })
console.log('yesterday recap', recap?.pig_name, recap?.outcome_text, recap?.snapshot?.is_makeup)

// 预约烤猪：目标尚未抽猪 -> 建预约；目标抽猪后自动开炉
fake = makeE('1001', {
  msg: '烤群友',
  at: '1004',
  message: [{ type: 'at', qq: '1004' }, { type: 'text', text: '烤群友' }]
})
await plugin.memberRoast(fake.e)
const pending = Object.values(getState().reservations || {}).find(item => item.target_id === '1004' && item.status === 'pending')
console.log('reservation notice', fake.replies.map(item => String(item).slice(0, 50)), pending?.status, pending?.notice_message_id)
if (pending) {
  const targetDraw = await getOrCreateDailyRoll({ userId: '1004', officialPigs: plugin.pigData, date, groupId: '2001' })
  const { activateReservationsForTarget } = await import('../lib/roast/reservations.js')
  const { deliverReadyReservations } = await import('../lib/roast/delivery.js')
  await activateReservationsForTarget({ targetId: '1004', targetPigId: targetDraw.pig_id, date })
  await deliverReadyReservations({ groupId: '2001' })
  const done = getState().reservations[pending.reservation_id]
  console.log('reservation delivered', done?.status, groupMessages.length, done?.outcome_snapshot?.type)
}

fs.rmSync(SMOKE_DATA, { recursive: true, force: true })
console.log('COMMAND SMOKE OK')
