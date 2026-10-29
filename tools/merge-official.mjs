// 一次性数据工具：把 nonebot-plugin-rollpig-plus 的本地猪库合并进本插件的官方猪库。
//
// 规则（已与维护者确认）：
// - 同 id 一律保留本插件现有条目，不覆盖图片/文案
// - 新 id 只有在“名称+简述+分析+图片 MD5”都与现有条目完全一致时才跳过
// - 目标图片已存在且内容不同时直接报错，绝不静默覆盖
//
// 用法：
//   node tools/merge-official.mjs --dry-run
//   node tools/merge-official.mjs
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PLUGIN_ROOT = path.resolve(__dirname, '..')
const TARGET_JSON = path.join(PLUGIN_ROOT, 'resource', 'pig.json')
const TARGET_IMG = path.join(PLUGIN_ROOT, 'resource', 'image')
const DEFAULT_SOURCE = path.resolve(
  PLUGIN_ROOT,
  '../../..',
  'nonebot-plugin-rollpig-plus',
  'nonebot_plugin_rollpig_plus',
  'resource'
)

const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.gif', '.webp']
const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const sourceIndex = args.indexOf('--source')
const SOURCE_DIR = sourceIndex >= 0 && args[sourceIndex + 1]
  ? path.resolve(args[sourceIndex + 1])
  : DEFAULT_SOURCE

const md5File = file => crypto.createHash('md5').update(fs.readFileSync(file)).digest('hex')

const findImage = (dir, id) => {
  for (const ext of IMAGE_EXTS) {
    const file = path.join(dir, id + ext)
    if (fs.existsSync(file)) return file
  }
  return null
}

const pickFields = raw => ({
  id: String(raw.id || '').trim(),
  name: String(raw.name || '').trim(),
  description: String(raw.description || ''),
  analysis: String(raw.analysis || ''),
})

const fail = message => {
  console.error(`[merge-official] ${message}`)
  process.exit(1)
}

if (!fs.existsSync(TARGET_JSON)) fail(`找不到目标猪库：${TARGET_JSON}`)
if (!fs.existsSync(SOURCE_DIR)) fail(`找不到源资源目录：${SOURCE_DIR}`)

const targetPigs = JSON.parse(fs.readFileSync(TARGET_JSON, 'utf8'))
const sourcePigs = JSON.parse(fs.readFileSync(path.join(SOURCE_DIR, 'pig.json'), 'utf8'))
if (!Array.isArray(targetPigs) || !Array.isArray(sourcePigs)) fail('pig.json 必须是数组')

const targetIds = new Set()
const contentIndex = new Map()
const targetImages = new Map()

for (const raw of targetPigs) {
  const pig = pickFields(raw)
  if (!pig.id) fail('目标猪库存在空 id')
  if (targetIds.has(pig.id)) fail(`目标猪库存在重复 id：${pig.id}`)
  targetIds.add(pig.id)
  const image = findImage(TARGET_IMG, pig.id)
  const md5 = image ? md5File(image) : ''
  targetImages.set(pig.id, { path: image, md5 })
  contentIndex.set(JSON.stringify([pig.name, pig.description, pig.analysis, md5]), pig.id)
}

const added = []
const skippedSameId = []
const skippedDuplicate = []
const copiedImages = []
const imageCollisions = []

for (const raw of sourcePigs) {
  const pig = pickFields(raw)
  if (!pig.id || !pig.name) fail('源猪库存在空 id 或空名称')
  if (targetIds.has(pig.id)) {
    skippedSameId.push(pig.id)
    continue
  }

  const sourceImage = findImage(path.join(SOURCE_DIR, 'image'), pig.id)
  if (!sourceImage) fail(`源猪库缺少图片：${pig.id}`)
  const md5 = md5File(sourceImage)
  const contentKey = JSON.stringify([pig.name, pig.description, pig.analysis, md5])
  if (contentIndex.has(contentKey)) {
    skippedDuplicate.push({ id: pig.id, sameAs: contentIndex.get(contentKey) })
    continue
  }

  const targetImage = findImage(TARGET_IMG, pig.id)
  if (targetImage) {
    const targetMd5 = md5File(targetImage)
    if (targetMd5 !== md5) {
      imageCollisions.push({ id: pig.id, target: targetImage, source: sourceImage })
      continue
    }
  }

  targetIds.add(pig.id)
  contentIndex.set(contentKey, pig.id)
  added.push({ pig, sourceImage, targetImage, md5 })
}

// 已知历史问题：id 是 astrnomer-pig，图片却叫 astronomer-pig.png。
// 保留 id 不破坏旧记录，把图片补齐为 id 对应的文件名。
const typoFix = []
const typoPig = targetPigs.find(p => p.id === 'astrnomer-pig')
if (typoPig) {
  const expected = findImage(TARGET_IMG, 'astrnomer-pig')
  const legacy = path.join(TARGET_IMG, 'astronomer-pig.png')
  if (!expected && fs.existsSync(legacy)) {
    typoFix.push({ from: legacy, to: path.join(TARGET_IMG, 'astrnomer-pig.png') })
  }
}

if (imageCollisions.length) {
  console.error('[merge-official] 以下新 id 的目标图片已存在但与源图不同，已中止：')
  for (const item of imageCollisions) console.error(`  ${item.id}: ${item.target} != ${item.source}`)
  process.exit(1)
}

console.log('[merge-official] 源目录:', SOURCE_DIR)
console.log('[merge-official] 目标条目:', targetPigs.length, '源条目:', sourcePigs.length)
console.log('[merge-official] 同 id 跳过:', skippedSameId.length)
console.log('[merge-official] 跨 id 完全重复跳过:', skippedDuplicate.length)
console.log('[merge-official] 新增条目:', added.length)
console.log('[merge-official] 合并后条目:', targetPigs.length + added.length)
if (skippedDuplicate.length) {
  console.log('[merge-official] 完全重复明细:', skippedDuplicate)
}
if (typoFix.length) {
  console.log('[merge-official] 将修复 astrnomer-pig 图片:', typoFix[0])
}

if (dryRun) {
  console.log('[merge-official] --dry-run：未写入任何文件')
  console.log('[merge-official] 新增 id:', added.map(item => item.pig.id).join(', '))
  process.exit(0)
}

for (const item of added) {
  const ext = path.extname(item.sourceImage)
  const targetPath = path.join(TARGET_IMG, item.pig.id + ext)
  if (!fs.existsSync(targetPath)) {
    fs.copyFileSync(item.sourceImage, targetPath)
    copiedImages.push(targetPath)
  }
  targetPigs.push(item.pig)
}
for (const fix of typoFix) {
  fs.copyFileSync(fix.from, fix.to)
  copiedImages.push(fix.to)
}

const backup = TARGET_JSON + '.bak'
fs.copyFileSync(TARGET_JSON, backup)
const temporary = TARGET_JSON + '.tmp'
fs.writeFileSync(temporary, JSON.stringify(targetPigs, null, 4) + '\n', 'utf8')
fs.renameSync(temporary, TARGET_JSON)

console.log('[merge-official] 已复制图片:', copiedImages.length)
console.log('[merge-official] 已备份:', backup)
console.log('[merge-official] 写入完成:', TARGET_JSON)
console.log('[merge-official] 新增 id:', added.map(item => item.pig.id).join(', '))
