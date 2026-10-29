// 静态资源校验：猪库、EX 差分、日报/昨日素材、字体。
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const RES = path.join(ROOT, 'resource')
const IMG = path.join(RES, 'image')
const EXTS = ['.png', '.jpg', '.jpeg', '.gif', '.webp']
const errors = []
const warnings = []

const findImage = (dir, id) => {
  for (const ext of EXTS) {
    const file = path.join(dir, id + ext)
    if (fs.existsSync(file)) return file
  }
  return null
}

const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'))

const pigs = readJson(path.join(RES, 'pig.json'))
if (!Array.isArray(pigs)) errors.push('pig.json 不是数组')
const ids = new Set()
for (const pig of pigs) {
  if (!pig?.id) { errors.push('pig.json 存在空 id'); continue }
  if (ids.has(pig.id)) errors.push(`pig.json 重复 id: ${pig.id}`)
  ids.add(pig.id)
  if (!findImage(IMG, pig.id)) errors.push(`缺少图片: ${pig.id}`)
  if (!pig.name) warnings.push(`缺少名称: ${pig.id}`)
}

const variants = readJson(path.join(RES, 'pig_ex_variants.json'))
for (const [pigId, entry] of Object.entries(variants.pigs || {})) {
  if (!ids.has(pigId)) errors.push(`差分引用不存在于猪库: ${pigId}`)
  for (const [level, data] of Object.entries(entry.levels || {})) {
    if (!data.image && !data.description && !data.analysis) errors.push(`差分等级为空: ${pigId} EX${level}`)
    if (data.image && !findImage(IMG, `${pigId}_ex${level}`)) errors.push(`差分图片缺失: ${pigId}_ex${level}`)
  }
}

const required = {
  report: [
    'clean-paper-original-tone.jpg', 'header_pig_news.png', 'coupon_surface.jpg',
    'coupon_shield.png', 'coupon_barcode.png', 'ink-texture-black.png', 'ink-texture-red.png',
    'stats_people.png', 'stats_flame.png', 'stats_calendar.png', 'stats_escape.png',
    'stats_backfire.png', 'stats_pig_variety.png',
    'observation_reservation.png', 'observation_backfire.png', 'observation_escape.png',
    'observation_roast_success.png', 'observation_human.png', 'observation_collision.png',
    'observation_variety.png', 'observation_paw.png',
    'headline_roast_success.png', 'headline_escape.png', 'headline_backfire.png',
    'headline_self_roast.png', 'headline_bot_backfire.png', 'headline_reservation_success.png',
    'headline_reservation_escape.png', 'headline_reservation_backfire.png',
    'headline_reservation_human.png', 'headline_reservation_food.png',
    'headline_reservation_eaten.png', 'headline_reservation_sold.png',
    'event_fire.png', 'event_run.png', 'event_angry.png', 'event_reservation.png',
    'event_special_target.png'
  ],
  yesterday: [
    'backgrounds/pink_dream.jpg', 'header_book@4x.png', 'header_divider@4x.png',
    'highlight_divider@4x.png', 'summary_divider@4x.png', 'tape@4x.png', 'heart@4x.png',
    'shield@4x.png', 'sparkle@4x.png', 'flame@4x.png', 'runner@4x.png',
    'decor/braces_pink.png', 'decor/flower_pink.png', 'decor/sparkle_gold_large.png',
    'decor/sparkle_pink.png'
  ],
  fonts: [
    'SourceHanSansSC-Medium.otf', 'RollPigDailySerif-Black.subset.otf',
    'RollPigDailySerif-Bold.subset.otf', 'RollPigDailySerif-Regular.subset.otf',
    'ZCOOLKuaiLe-Regular.ttf', 'emoji.css'
  ]
}
for (const [dir, files] of Object.entries(required)) {
  for (const file of files) {
    if (!fs.existsSync(path.join(RES, dir, file))) errors.push(`缺少素材: ${dir}/${file}`)
  }
}
if (!fs.existsSync(path.join(RES, 'refill.jpg'))) errors.push('缺少素材: refill.jpg')
if (!fs.existsSync(path.join(RES, 'pig_rules.json'))) errors.push('缺少 pig_rules.json')
if (!fs.existsSync(path.join(RES, 'report.html'))) errors.push('缺少 report.html')
if (!fs.existsSync(path.join(RES, 'yesterday.html'))) errors.push('缺少 yesterday.html')

const emojiDir = path.join(RES, 'fonts', 'emoji')
if (fs.existsSync(emojiDir)) {
  const fragments = fs.readdirSync(emojiDir).filter(file => file.endsWith('.woff2'))
  if (!fragments.length) errors.push('Emoji 字体分片为空')
} else {
  errors.push('缺少字体目录: fonts/emoji')
}

const texts = readJson(path.join(RES, 'texts.json'))
for (const key of [
  'TOMORROW_TEXTS', 'YESTERDAY_MAKEUP_TEXTS', 'DAILY_ROLL_NEW_PIG_TEXTS',
  'DAILY_ROLL_DUPLICATE_LEVEL_UP_TEXTS', 'DAILY_ROLL_DUPLICATE_SAME_LEVEL_TEXTS',
  'DAILY_ROLL_VARIANT_LEVEL_UP_TEXTS', 'ROAST_RESERVATION_CREATED_TEXTS',
  'DAILY_REPORT_OBSERVATION_TEXTS', 'DAILY_REPORT_HEADLINE_TEXTS',
  'DAILY_REPORT_TIMELINE_INTRO_TEXTS', 'DAILY_REPORT_TIMELINE_DETAIL_TEXTS',
  'YESTERDAY_EXPERIENCE_TEXTS', 'YESTERDAY_SUMMARY_TEXTS'
]) {
  if (!(key in texts)) errors.push(`texts.json 缺少 ${key}`)
}

console.log(`[validate-assets] 猪库: ${pigs.length} 只，图片齐全: ${pigs.length - errors.filter(item => item.startsWith('缺少图片')).length}`)
console.log(`[validate-assets] 差分: ${Object.keys(variants.pigs || {}).length} 只`)
console.log(`[validate-assets] 警告: ${warnings.length}`)
for (const warning of warnings.slice(0, 20)) console.warn('  ⚠', warning)
console.log(`[validate-assets] 错误: ${errors.length}`)
for (const error of errors) console.error('  ✗', error)
if (errors.length) process.exit(1)
console.log('[validate-assets] OK')
