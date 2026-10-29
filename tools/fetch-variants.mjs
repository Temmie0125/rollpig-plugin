// 下载官方 RollPig 资源包中的 EX 差分数据与图片，并过滤到当前猪库实际存在的 id。
// 官方包目前只提供 _ex2 图片；EX5 只有 description/analysis，因此保留为纯文案差分。
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PLUGIN_ROOT = path.resolve(__dirname, '..')
const PIG_JSON = path.join(PLUGIN_ROOT, 'resource', 'pig.json')
const IMAGE_DIR = path.join(PLUGIN_ROOT, 'resource', 'image')
const OUTPUT_JSON = path.join(PLUGIN_ROOT, 'resource', 'pig_ex_variants.json')
const BASE = 'https://pig.felislab.cc/resources/rollpig/'

const sha256 = buffer => crypto.createHash('sha256').update(buffer).digest('hex')

const fetchBytes = async url => {
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) })
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`)
  return Buffer.from(await response.arrayBuffer())
}

const main = async () => {
  const pigs = JSON.parse(fs.readFileSync(PIG_JSON, 'utf8'))
  const ids = new Set(pigs.map(pig => String(pig.id)))
  const manifest = await (await fetch(BASE + 'manifest.json', { signal: AbortSignal.timeout(30_000) })).json()
  const raw = await (await fetch(BASE + 'pig_ex_variants.json', { signal: AbortSignal.timeout(30_000) })).json()

  const images = new Map()
  for (const item of manifest.variant_images || []) {
    images.set(`${item.pig_id}:${item.level}`, item)
  }

  const output = { schema_version: 1, pigs: {} }
  const downloaded = []
  const missingImages = []
  let droppedIds = 0

  for (const [pigId, entry] of Object.entries(raw.pigs || {})) {
    if (!ids.has(pigId)) {
      droppedIds++
      continue
    }
    if (!entry || typeof entry !== 'object' || !entry.levels || typeof entry.levels !== 'object') continue
    const levels = {}
    for (const [levelKey, level] of Object.entries(entry.levels)) {
      const levelNumber = Number(levelKey)
      if (!Number.isInteger(levelNumber) || levelNumber < 1 || levelNumber > 5) continue
      if (!level || typeof level !== 'object') continue
      const cleaned = {}
      if (typeof level.description === 'string' && level.description.trim()) cleaned.description = level.description
      if (typeof level.analysis === 'string' && level.analysis.trim()) cleaned.analysis = level.analysis
      if (typeof level.image === 'string' && level.image.trim()) {
        const meta = images.get(`${pigId}:${levelNumber}`)
        if (meta) {
          const target = path.join(IMAGE_DIR, meta.filename)
          if (!fs.existsSync(target)) {
            const buffer = await fetchBytes(BASE + meta.path)
            if (buffer.length !== meta.size) throw new Error(`大小校验失败: ${meta.filename}`)
            if (sha256(buffer) !== meta.sha256) throw new Error(`SHA-256 校验失败: ${meta.filename}`)
            const temporary = target + '.tmp'
            fs.writeFileSync(temporary, buffer)
            fs.renameSync(temporary, target)
            downloaded.push(meta.filename)
          }
          cleaned.image = meta.filename
        } else {
          // 官方包没有该等级的图；保留文案差分，去掉不存在的图片引用。
          missingImages.push(`${pigId}:${levelNumber}`)
        }
      }
      if (Object.keys(cleaned).length) levels[levelKey] = cleaned
    }
    if (Object.keys(levels).length) output.pigs[pigId] = { levels }
  }

  const temporary = OUTPUT_JSON + '.tmp'
  fs.writeFileSync(temporary, JSON.stringify(output, null, 2) + '\n', 'utf8')
  fs.renameSync(temporary, OUTPUT_JSON)

  console.log('[fetch-variants] 官方差分猪:', Object.keys(raw.pigs || {}).length)
  console.log('[fetch-variants] 过滤后差分猪:', Object.keys(output.pigs).length)
  console.log('[fetch-variants] 不在本地库、已跳过:', droppedIds)
  console.log('[fetch-variants] 已下载图片:', downloaded.length)
  console.log('[fetch-variants] 无图但保留文案的等级:', missingImages.length)
  console.log('[fetch-variants] 写入:', OUTPUT_JSON)
}

main().catch(error => {
  console.error('[fetch-variants] 失败:', error)
  process.exit(1)
})
