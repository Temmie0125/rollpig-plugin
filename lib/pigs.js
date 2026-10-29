// 猪库 / EX 等级 / 差分解析 / 烤猪形态规则。
// 官方与自定义图鉴仍由 custom-store 合并；这里只负责在其上叠加成长与差分。
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import {
  CUSTOM_DIR,
  CUSTOM_IMG_DIR,
  IMAGE_EXTS,
  OFFICIAL_IMG_DIR,
  findPigImageAny,
  getMergedPigs
} from './custom-store.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const PLUGIN_ROOT = path.resolve(__dirname, '..')
export const OFFICIAL_VARIANTS_PATH = path.join(PLUGIN_ROOT, 'resource', 'pig_ex_variants.json')
export const CUSTOM_VARIANTS_PATH = path.join(CUSTOM_DIR, 'pig_ex_variants.json')
export const PIG_RULES_PATH = path.join(PLUGIN_ROOT, 'resource', 'pig_rules.json')
export const MAX_EX = 5

const log = () => globalThis.logger || console
export const clampEx = value => Math.min(MAX_EX, Math.max(0, Math.trunc(Number(value) || 0)))

/** copies 与 growth_bonus 合成 EX Lv.0-5；加餐只加 growth_bonus，不增加 copies */
export const expertLevel = (copies, growthBonus = 0) =>
  clampEx(Math.trunc(Number(copies) || 0) - 1 + Math.trunc(Number(growthBonus) || 0))

const probeImage = (dir, id) => {
  for (const ext of IMAGE_EXTS) {
    const file = path.join(dir, id + ext)
    if (fs.existsSync(file)) return file
  }
  return null
}

/** 差分图片按 <id>_ex<level> 约定探测，custom 优先 */
export const findVariantImage = (pigId, level) => {
  const id = `${pigId}_ex${Number(level)}`
  return probeImage(CUSTOM_IMG_DIR, id) || probeImage(OFFICIAL_IMG_DIR, id)
}

export const findBaseImage = pigId => findPigImageAny(pigId)
export { findPigImageAny }

const sanitizeVariantLevel = raw => {
  if (!raw || typeof raw !== 'object') return null
  const level = {}
  if (typeof raw.description === 'string' && raw.description.trim()) level.description = raw.description
  if (typeof raw.analysis === 'string' && raw.analysis.trim()) level.analysis = raw.analysis
  if (typeof raw.image === 'string' && raw.image.trim()) level.image = raw.image.trim()
  return Object.keys(level).length ? level : null
}

const loadVariantFile = file => {
  try {
    if (!fs.existsSync(file)) return null
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (!raw || typeof raw !== 'object' || !raw.pigs || typeof raw.pigs !== 'object') return null
    const pigs = {}
    for (const [pigId, entry] of Object.entries(raw.pigs)) {
      if (!entry || typeof entry !== 'object' || !entry.levels || typeof entry.levels !== 'object') continue
      const levels = {}
      for (const [levelKey, rawLevel] of Object.entries(entry.levels)) {
        const levelNumber = Number(levelKey)
        if (!Number.isInteger(levelNumber) || levelNumber < 1 || levelNumber > MAX_EX) continue
        const level = sanitizeVariantLevel(rawLevel)
        if (level) levels[levelNumber] = level
      }
      if (Object.keys(levels).length) pigs[pigId] = levels
    }
    return pigs
  } catch (error) {
    log().warn?.(`[今天是什么小猪] 差分文件读取失败 ${file}:`, error)
    return null
  }
}

const fileFingerprint = file => {
  try {
    const stat = fs.statSync(file)
    return `${stat.mtimeMs}:${stat.size}`
  } catch {
    return 'missing'
  }
}

const VARIANTS_CACHE_KEY = '__rollpig_variants_cache'

export const loadVariants = () => {
  const fingerprint = [
    fileFingerprint(OFFICIAL_VARIANTS_PATH),
    fileFingerprint(CUSTOM_VARIANTS_PATH),
    fileFingerprint(CUSTOM_IMG_DIR),
    fileFingerprint(OFFICIAL_IMG_DIR)
  ].join('|')
  const cached = globalThis[VARIANTS_CACHE_KEY]
  if (cached && cached.fingerprint === fingerprint) return cached.data

  const data = {}
  const official = loadVariantFile(OFFICIAL_VARIANTS_PATH)
  for (const [pigId, levels] of Object.entries(official || {})) data[pigId] = { ...levels }
  const custom = loadVariantFile(CUSTOM_VARIANTS_PATH)
  for (const [pigId, levels] of Object.entries(custom || {})) {
    data[pigId] ||= {}
    for (const [levelNumber, level] of Object.entries(levels)) {
      data[pigId][levelNumber] = { ...(data[pigId][levelNumber] || {}), ...level }
    }
  }
  globalThis[VARIANTS_CACHE_KEY] = { fingerprint, data }
  return data
}

/** 按等级解析外观与文案；纯文案等级也生效，图片缺失时保留低等级图 */
export const resolveAppearance = (pig, exLevel = 0) => {
  const resolved = { ...pig }
  const pigId = String(resolved.id || '')
  const requested = clampEx(exLevel)
  const baseImagePath = findBaseImage(pigId)
  let imagePath = baseImagePath
  let appliedLevel = 0
  const variants = loadVariants()[pigId] || {}

  for (let level = 1; level <= requested; level++) {
    const variant = variants[level]
    if (!variant) continue
    if (variant.image) {
      const found = findVariantImage(pigId, level)
      if (found) imagePath = found
      else log().warn?.(`[今天是什么小猪] 差分图片缺失 ${pigId}_ex${level}`)
    }
    if (variant.description !== undefined) resolved.description = variant.description
    if (variant.analysis !== undefined) resolved.analysis = variant.analysis
    appliedLevel = level
  }

  return {
    pig: resolved,
    imagePath,
    baseImagePath,
    requestedLevel: requested,
    appliedLevel,
    availableLevels: availableVariantLevels(pigId)
  }
}

export const availableVariantLevels = pigId => {
  const levels = loadVariants()[pigId] || {}
  return Object.keys(levels).map(Number).filter(level => {
    const variant = levels[level]
    return Boolean(variant && (variant.description || variant.analysis || findVariantImage(pigId, level)))
  }).sort((a, b) => a - b)
}

/** 从旧等级升到新等级时真正跨过的差分等级 */
export const newlyUnlockedVariantLevels = (pigId, previousLevel, currentLevel) => {
  const from = clampEx(previousLevel)
  const to = clampEx(currentLevel)
  if (to <= from) return []
  return availableVariantLevels(pigId).filter(level => level > from && level <= to)
}

/** 升级区间涉及哪些差分字段，用于选择“换图/换文案/两者”的成长文案 */
export const variantFieldsForLevels = (pigId, levels) => {
  const variants = loadVariants()[pigId] || {}
  const fields = new Set()
  for (const level of levels || []) {
    const variant = variants[level]
    if (!variant) continue
    if (variant.image && findVariantImage(pigId, level)) fields.add('image')
    if (variant.description !== undefined || variant.analysis !== undefined) fields.add('text')
  }
  return [...fields]
}

export const mergedPigs = officialPigs => getMergedPigs(officialPigs)

export const pigMap = officialPigs => new Map(mergedPigs(officialPigs).map(pig => [String(pig.id), pig]))

export const getPigById = (officialPigs, pigId) => pigMap(officialPigs).get(String(pigId || ''))

// ---------------- 烤猪形态规则 ----------------

// 当前库已有、但 plus 的 pig_rules.json 没覆盖到的熟食 id；合并后依然按熟食拦截。
const EXTRA_FOOD_IDS = [
  'porkchop-rice',
  'pig-bone-soup',
  'pig-dumpling',
  'pig-bun',
  'pig-tamagoyaki'
]

const RULES_CACHE_KEY = '__rollpig_rules_cache'

export const loadPigRules = () => {
  const fingerprint = fileFingerprint(PIG_RULES_PATH)
  const cached = globalThis[RULES_CACHE_KEY]
  if (cached && cached.fingerprint === fingerprint) return cached.data

  let raw = {}
  try {
    raw = JSON.parse(fs.readFileSync(PIG_RULES_PATH, 'utf8'))
  } catch (error) {
    log().warn?.('[今天是什么小猪] pig_rules.json 读取失败，使用内置规则:', error)
  }
  const food = new Set([...(raw.food_pigs || []), ...EXTRA_FOOD_IDS].map(String))
  const human = new Set([...(raw.human_pigs || ['human'])].map(String))
  const eaten = new Set([...(raw.eaten_pigs || ['eaten'])].map(String))
  const sold = new Set([...(raw.sold_pigs || ['sold-out'])].map(String))
  const data = { food, human, eaten, sold }
  globalThis[RULES_CACHE_KEY] = { fingerprint, data }
  return data
}

export const isFoodPig = pig => Boolean(pig && loadPigRules().food.has(String(pig.id)))
export const isHumanPig = pig => Boolean(pig && loadPigRules().human.has(String(pig.id)))
export const isEatenPig = pig => Boolean(pig && loadPigRules().eaten.has(String(pig.id)))
export const isSoldPig = pig => Boolean(pig && loadPigRules().sold.has(String(pig.id)))
export const canBackfireRoast = pig => Boolean(
  pig && !isFoodPig(pig) && !isHumanPig(pig) && !isEatenPig(pig) && !isSoldPig(pig)
)

export const pickFoodPig = (officialPigs, random = Math.random) => {
  const map = pigMap(officialPigs)
  const ids = [...loadPigRules().food].filter(id => map.has(id))
  if (!ids.length) throw new Error('熟食规则为空，请检查 pig_rules.json。')
  const id = ids[Math.floor(random() * ids.length)]
  return map.get(id)
}

export const pickRandomPig = (officialPigs, random = Math.random) => {
  const pigs = mergedPigs(officialPigs)
  if (!pigs.length) return null
  return pigs[Math.floor(random() * pigs.length)]
}

/** 加权保底选猪：未拥有猪权重 1 + min(streak*0.5, 4) */
export const pickWeightedPig = (officialPigs, ownedIds, duplicateStreak, random = Math.random) => {
  const pigs = mergedPigs(officialPigs)
  if (!pigs.length) return null
  const owned = ownedIds instanceof Set ? ownedIds : new Set(ownedIds || [])
  const streak = Math.max(0, Math.trunc(Number(duplicateStreak) || 0))
  const bonus = Math.min(streak * 0.5, 4)
  const weights = pigs.map(pig => (pig.id && !owned.has(String(pig.id)) ? 1 + bonus : 1))
  const total = weights.reduce((sum, weight) => sum + weight, 0)
  let roll = random() * total
  for (let index = 0; index < pigs.length; index++) {
    roll -= weights[index]
    if (roll <= 0) return pigs[index]
  }
  return pigs[pigs.length - 1]
}
