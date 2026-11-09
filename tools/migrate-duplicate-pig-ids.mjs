// 一次性数据工具：把用户数据里已删除的重复猪猪条目 id 重定向到保留侧 id，
// 避免图鉴统计进度（collection / pig_progress）和历史记录失效。
//
// 背景：合并 nonebot-plugin-rollpig-plus 时引入了一批与原有条目逐字或同名重复的猪，
// 已从 resource/pig.json 移除；本脚本把历史数据里残留的这些旧 id 归并到保留侧：
// - collection[uid]（数组）：替换并去重
// - pig_progress[uid]（进度表）：copies / growth_bonus 求和，first_obtained_at 取最早
// - records.json 的 pigs（legacy 图鉴）：copies 求和
// - 其余位置的字符串值 / 对象键（history、snapshots、group_rolls、daily_feeds、events 等）：原位替换
//
// 用法：
//   node tools/migrate-duplicate-pig-ids.mjs --dry-run
//   node tools/migrate-duplicate-pig-ids.mjs            # 会先写 .pre-migrate.bak 备份
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PLUGIN_ROOT = path.resolve(__dirname, '..')
const DATA_DIR = process.env.ROLLPIG_DATA_DIR
  ? path.resolve(process.env.ROLLPIG_DATA_DIR)
  : path.join(PLUGIN_ROOT, 'data')
const PIG_JSON = path.join(PLUGIN_ROOT, 'resource', 'pig.json')

// 旧 id -> 保留侧 id。两批来源：
// - f972fc4 删除的 8 条（同名/同文案重复）
// - 本轮清理删除的 20 条（合并引入的逐字重复）
const ID_ALIAS = {
  // f972fc4 批次
  'tiktok-pig': 'pigtok',
  'pig-meaning': 'yiwei-pig',
  'sold-out-pig': 'sold-out',
  'breakwall-pig': 'charge-pig',
  'pig-fishron': 'duke-pig',
  'fake-elephant-pig': 'elephant-pig',
  'arknight-pig': 'arknights-pig',
  'pig-on-pig': 'stacking-pig',
  // 本轮批次
  'rabbit-pig': 'pig-rabbit-cage',
  'upper-class-pig': 'elite-pig',
  'laborer-pig': 'job-pig',
  'lucky-mud-pig': 'dirt-luck-pig',
  'rail-pig': 'pig-rail',
  'dumpling-pig': 'pig-dumpling',
  'shop-pig': 'pig-shop',
  'tamagoyaki-pig': 'pig-tamagoyaki',
  'nurse-pig': 'pig-nurse',
  'ninja-pig': 'pig-ninja',
  'curator-pig': 'pig-cleaner',
  'pigskin-pig': 'pig-skin',
  'twitch-pig': 'convulsion-pig',
  'canned-pig': 'pig-can',
  'hotdog-pig': 'hot-pig',
  'fine-chaff-boar': 'mountain-pig',
  'jiahao-pig': 'alan-pig',
  'bone-soup-pig': 'pig-bone-soup',
  'civil-eng-pig': 'builder-pig',
  'astro-pig': 'astrnomer-pig'
}

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')

const officialIds = new Set(JSON.parse(fs.readFileSync(PIG_JSON, 'utf8')).map(p => p.id))
for (const [from, to] of Object.entries(ID_ALIAS)) {
  if (officialIds.has(from)) console.error(`[migrate] 异常：旧 id ${from} 仍存在于 pig.json，请先确认`)
  if (!officialIds.has(to)) {
    console.error(`[migrate] 中止：别名目标 ${to}（来自 ${from}）不在 pig.json`)
    process.exit(1)
  }
}

const stats = { values: 0, keys: 0, merges: 0, collection_dedup: 0 }
const mergeSamples = []

/** 归并两条进度记录：copies/growth_bonus 求和，first_obtained_at 取最早的非空值 */
const mergeProgress = (a, b) => {
  const pickTime = (x, y) => {
    const times = [x, y].filter(t => typeof t === 'string' && t).sort()
    return times[0] ?? (x === null || y === null ? null : undefined)
  }
  return {
    copies: Number(a.copies || 0) + Number(b.copies || 0),
    growth_bonus: Number(a.growth_bonus || 0) + Number(b.growth_bonus || 0),
    first_obtained_at: pickTime(a.first_obtained_at, b.first_obtained_at) ?? null
  }
}

const mergeValues = (existing, incoming, where) => {
  stats.merges++
  mergeSamples.push(where)
  if (typeof existing === 'number' && typeof incoming === 'number') return existing + incoming
  if (typeof existing === 'object' && existing && typeof incoming === 'object' && incoming) {
    if ('copies' in existing || 'copies' in incoming) return mergeProgress(existing, incoming)
    return { ...incoming, ...existing }
  }
  return existing
}

// 只有 collection[uid]（图鉴数组）需要去重；其余数组的重复项可能有业务含义，原样保留
const DEDUPE_KEYS = new Set(['collection'])

const rewrite = (node, dedupe = false) => {
  if (typeof node === 'string') {
    if (ID_ALIAS[node]) {
      stats.values++
      return ID_ALIAS[node]
    }
    return node
  }
  if (Array.isArray(node)) {
    const out = []
    for (const item of node) {
      const value = rewrite(item, dedupe)
      if (dedupe && out.includes(value)) {
        stats.collection_dedup++
        continue
      }
      out.push(value)
    }
    return out
  }
  if (node && typeof node === 'object') {
    const out = {}
    for (const [key, value] of Object.entries(node)) {
      const childDedupe = dedupe || DEDUPE_KEYS.has(key)
      const newKey = ID_ALIAS[key]
      if (newKey && newKey !== key) {
        stats.keys++
        if (newKey in out) {
          out[newKey] = mergeValues(out[newKey], rewrite(value, childDedupe), key)
        } else {
          out[newKey] = rewrite(value, childDedupe)
        }
      } else {
        out[key] = rewrite(value, childDedupe)
      }
    }
    return out
  }
  return node
}

const countDead = data => {
  let hits = 0
  const walk = node => {
    if (typeof node === 'string') { if (ID_ALIAS[node]) hits++; return }
    if (Array.isArray(node)) return node.forEach(walk)
    if (node && typeof node === 'object') return Object.entries(node).forEach(([k, v]) => { if (ID_ALIAS[k]) hits++; walk(v) })
  }
  walk(data)
  return hits
}

for (const name of ['state.json', 'records.json']) {
  const file = path.join(DATA_DIR, name)
  if (!fs.existsSync(file)) {
    console.log(`[migrate] 跳过（不存在）: ${file}`)
    continue
  }
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'))
  const before = countDead(raw)
  if (!before) {
    console.log(`[migrate] 无需迁移: ${name}`)
    continue
  }
  const migrated = rewrite(raw)
  const after = countDead(migrated)
  console.log(`[migrate] ${name}: 命中 ${before} 处 -> 剩余 ${after} 处`)
  if (after) {
    console.error(`[migrate] 中止：${name} 仍有未处理的旧 id（键冲突覆盖？），未写入任何文件`)
    process.exit(1)
  }
  if (dryRun) {
    console.log(`[migrate] --dry-run：${name} 未写入`)
    continue
  }
  const backup = file + '.pre-migrate.bak'
  if (!fs.existsSync(backup)) fs.copyFileSync(file, backup)
  fs.writeFileSync(file, JSON.stringify(migrated, null, 2) + '\n')
  console.log(`[migrate] 已写入 ${file}（备份: ${backup}）`)
}

console.log(`[migrate] 汇总: 值替换 ${stats.values}，键替换 ${stats.keys}，进度合并 ${stats.merges}，图鉴去重 ${stats.collection_dedup}`)
if (mergeSamples.length) console.log('[migrate] 合并位置:', mergeSamples.join(', '))
if (dryRun) console.log('[migrate] --dry-run：未修改任何文件')
