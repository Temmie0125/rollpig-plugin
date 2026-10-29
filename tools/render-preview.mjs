// 用宿主真实渲染器生成日报/昨日卡预览，便于和 plus 的效果图对照。
// 用法：在任意目录执行 node tools/render-preview.mjs
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PLUGIN_ROOT = path.resolve(__dirname, '..')
const YUNZAI_ROOT = path.resolve(PLUGIN_ROOT, '../..')
process.chdir(YUNZAI_ROOT)
globalThis.logger = new Proxy(console, {
  get(target, prop) {
    if (prop in target) return target[prop]
    return (...args) => console.log(...args)
  }
})

const { buildDailyReport } = await import('../lib/report/build.js')
const { buildReportRenderData } = await import('../lib/report/render.js')
const { buildYesterdayRenderData } = await import('../lib/yesterday-render.js')
const { listOfficialPigs } = await import('../lib/custom-store.js')
const { findPigImageAny } = await import('../lib/pigs.js')
const { todayStr } = await import('../lib/time.js')

const renderer = (await import('../../../lib/puppeteer/puppeteer.js')).default
const outputDir = path.join(PLUGIN_ROOT, 'temp')
fs.mkdirSync(outputDir, { recursive: true })

const save = async (name, tplFile, data, file) => {
  const result = await renderer.render(name, { tplFile, saveId: name, ...data })
  if (!result) throw new Error(`${name} 渲染返回空`)
  if (Buffer.isBuffer(result)) fs.writeFileSync(file, result)
  else if (typeof result === 'string' && fs.existsSync(result)) fs.copyFileSync(result, file)
  else throw new Error(`${name} 返回类型未知: ${typeof result}`)
  console.log('saved', file, fs.statSync(file).size)
}

const date = todayStr()
const pigs = listOfficialPigs()
const pigIds = ['pig', 'human', 'bacon', 'ghost-pig', 'pig-king', 'sleepy-pig', 'coder-pig', 'chef-pig', 'ninja-pig', 'doctor-pig', 'ai-pig', 'cloud-pig']
const rolls = {}
for (let index = 0; index < 12; index++) rolls[`u${index}`] = pigIds[index % pigIds.length]
const now = new Date().toISOString()
let eventIndex = 0
const makeEvent = (type, attacker, target, extra = {}) => ({
  event_id: `${type}-${eventIndex++}`,
  date,
  created_at: now,
  type,
  attacker,
  target,
  attacker_name: `群友${attacker.slice(1)}`,
  target_name: `群友${target === 'bot' ? 'Bot' : target.slice(1)}`,
  group_id: '123456',
  ...extra
})
const events = [
  makeEvent('success', 'u1', 'u2', {
    food: '培根', reservation_id: 'r1', participant_ids: ['u1', 'u3', 'u4', 'u5', 'u6', 'u7'],
    participant_names: ['群友1', '群友3', '群友4', '群友5', '群友6', '群友7'], participant_count: 6,
    protection_level: 3, force_mode: ''
  }),
  makeEvent('success', 'u3', 'u4', { food: '烤猪' }),
  makeEvent('escape', 'u2', 'u1', {}),
  makeEvent('success', 'u2', 'u1', { food: '叉烧' }),
  makeEvent('escape', 'u5', 'u6', {}),
  makeEvent('backfire', 'u7', 'u8', { backfire_victim_id: 'u7', backfire_victim_name: '群友7', food: '叉烧' }),
  makeEvent('self_roast', 'u9', 'u9', { food: '烤猪' }),
  makeEvent('bot_backfire', 'u10', 'bot', { food: '培根' }),
  makeEvent('reserved_special', 'u11', 'u12', {
    reservation_id: 'r2', participant_ids: ['u11', 'u12'], participant_names: ['群友11', '群友12'],
    participant_count: 2, special_reason: 'human', food: ''
  })
]
const profiles = {}
for (let index = 0; index < 12; index++) {
  const pig = pigs.find(item => item.id === rolls[`u${index}`])
  profiles[`u${index}`] = {
    user_id: `u${index}`,
    display_name: `群友${index}`,
    daily_pig_id: pig?.id || '',
    daily_pig_name: pig?.name || '',
    daily_ex_level: index % 6,
    daily_image_name: '',
    daily_achieved_at: now,
    catalog_count: 20 + index,
    catalog_achieved_at: '',
    recent_pig_id: pig?.id || '',
    recent_pig_name: pig?.name || '',
    recent_image_name: ''
  }
}
const report = buildDailyReport({
  date,
  groupId: '123456',
  groupRolls: rolls,
  rawEvents: events,
  activeUserIds: Object.keys(rolls),
  botUserIds: ['bot'],
  profiles,
  protections: [{ user_id: 'u2', display_name: '群友2', base_level: 3, roast_count: 3 }],
  humanPigIds: ['human'],
  cutoffIso: `${date}T23:45:00+08:00`
})
await save(
  'rollpig-preview-report',
  path.join(PLUGIN_ROOT, 'resource', 'report.html'),
  buildReportRenderData({ report, officialPigs: pigs }),
  path.join(outputDir, 'preview-report.png')
)

const yesterday = {
  date_str: date,
  snapshot: { pig_id: 'heaven-pig', is_makeup: false },
  pig_id: 'heaven-pig',
  pig_name: '天堂猪',
  pig_description: '',
  pig_analysis: '',
  image_path: findPigImageAny('heaven-pig') || findPigImageAny('pig'),
  fallback_image_path: '',
  outcome_text: '重复抽取 · EX Lv.2 → 3',
  footprints: [
    { label: '成功逃脱', count: 2 },
    { label: '烤成别人', count: 1 },
    { label: '已结算预约', count: 3 }
  ],
  experiences: [
    { text: '你和【奶糖】联手，把【倒霉蛋】送进了烤箱。' },
    { text: '【小明】刚举起夹子，你已经顶着光环飞走了。' }
  ],
  summary: { text: '昨天一边躲夹子，一边替群友添柴，猪圈两头都没闲着。' },
  aftereffect_text: '',
  events_available: true
}
await save(
  'rollpig-preview-yesterday',
  path.join(PLUGIN_ROOT, 'resource', 'yesterday.html'),
  buildYesterdayRenderData(yesterday),
  path.join(outputDir, 'preview-yesterday.png')
)

process.exit(0)
