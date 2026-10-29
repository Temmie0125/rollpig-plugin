// 日报端到端烟雾测试：伪造 23:50 上海时间，验证保护结算、装配、渲染、发送状态。
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
const { segment } = await import('oicq')
globalThis.segment = segment

const sent = []
globalThis.Bot = {
  uin: ['999'],
  bots: {},
  gml: new Map(),
  fl: new Map(),
  pickGroup: () => ({
    sendMsg: async message => {
      sent.push(message)
      return { message_id: `g${sent.length}` }
    },
    getMemberMap: async () => new Map()
  }),
  pickMember: () => ({})
}
fs.rmSync(SMOKE_DATA, { recursive: true, force: true })

const { listOfficialPigs } = await import('../lib/custom-store.js')
const daily = await import('../lib/daily.js')
const { appendRoastEvent } = await import('../lib/roast/events.js')
const { setReportEnabled, runDailyReportJob } = await import('../lib/report/job.js')
const { getState } = await import('../lib/state.js')

const pigs = listOfficialPigs()
const date = '2026-10-29'
const groupId = '2001'
for (const uid of ['1001', '1002', '1003']) {
  await daily.getOrCreateDailyRoll({ userId: uid, officialPigs: pigs, date, groupId })
}
await setReportEnabled(groupId, true)
const now = `${date}T14:00:00.000Z`
for (let index = 0; index < 3; index++) {
  await appendRoastEvent({
    date,
    created_at: now,
    type: 'success',
    attacker: '1001',
    target: '1002',
    attacker_name: '甲',
    target_name: '乙',
    food: '培根',
    group_id: groupId
  })
}
await appendRoastEvent({
  date, created_at: now, type: 'escape', attacker: '1002', target: '1001',
  attacker_name: '乙', target_name: '甲', group_id: groupId
})

const realNow = Date.now
Date.now = () => Date.parse('2026-10-29T15:50:00.000Z') // 上海 23:50
const result = await runDailyReportJob({ reportDate: date, randomDelay: false })
Date.now = realNow
console.log('job result', result)
console.log('sent', sent.length, sent[0]?.type, sent[0]?.file ? 'file' : typeof sent[0])
console.log('delivery', getState().report_deliveries?.[date]?.[groupId])
console.log('settlement', getState().settlements?.[date]?.[groupId])
fs.rmSync(SMOKE_DATA, { recursive: true, force: true })
console.log('REPORT JOB SMOKE OK')
process.exit(0)
