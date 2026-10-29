// 今日小猪：保底权重、每日 get-or-create、快照、成长文案、昨日补签。
import {
  expertLevel,
  getPigById,
  mergedPigs,
  newlyUnlockedVariantLevels,
  pickWeightedPig,
  resolveAppearance,
  variantFieldsForLevels
} from './pigs.js'
import { mutateState, getState, ensureState } from './state.js'
import { formatText, pickText, texts } from './texts.js'
import { nowIso, todayStr, yesterdayStr } from './time.js'

const log = () => globalThis.logger || console

export const getHistoryPigId = (date, userId) =>
  getState().history?.[date]?.[String(userId)] || ''

export const getProgressEntry = (userId, pigId) => {
  const entry = getState().pig_progress?.[String(userId)]?.[String(pigId)]
  if (entry && typeof entry === 'object') {
    return {
      copies: Math.max(0, Math.trunc(Number(entry.copies) || 0)),
      growth_bonus: Math.max(0, Math.trunc(Number(entry.growth_bonus) || 0)),
      first_obtained_at: entry.first_obtained_at || null
    }
  }
  const collected = (getState().collection?.[String(userId)] || []).includes(String(pigId))
  return { copies: collected ? 1 : 0, growth_bonus: 0, first_obtained_at: null }
}

export const getExLevel = (userId, pigId) => {
  const progress = getProgressEntry(userId, pigId)
  return expertLevel(progress.copies, progress.growth_bonus)
}

export const ownedPigIds = userId => {
  const state = ensureState()
  const progress = state.pig_progress?.[String(userId)]
  if (progress && typeof progress === 'object') return Object.keys(progress)
  return Array.isArray(state.collection?.[String(userId)]) ? state.collection[String(userId)] : []
}

const buildLegacySnapshot = (date, userId, pigId) => {
  const progress = getProgressEntry(userId, pigId)
  const copies = progress.copies
  const previousCopies = copies > 1 ? copies - 1 : 0
  return {
    pig_id: pigId,
    is_new_pig: copies <= 1,
    previous_copies: previousCopies,
    copies,
    previous_level: expertLevel(previousCopies, progress.growth_bonus),
    level: expertLevel(copies, progress.growth_bonus),
    collection_size: ownedPigIds(userId).length,
    is_makeup: false,
    source: 'legacy',
    created_at: null,
    date
  }
}

/** 读取某天的抽取快照；旧记录没有快照时按当前进度推导一个只读快照 */
export const getDailySnapshot = (date, userId) => {
  const stored = getState().snapshots?.[date]?.[String(userId)]
  if (stored && typeof stored === 'object') return stored
  const pigId = getHistoryPigId(date, userId)
  if (!pigId) return null
  return buildLegacySnapshot(date, userId, pigId)
}

export const recordGroupRoll = (state, date, groupId, userId, pigId) => {
  if (!groupId) return
  const gid = String(groupId)
  const uid = String(userId)
  const timestamp = nowIso()
  state.group_rolls[date] ||= {}
  state.group_rolls[date][gid] ||= {}
  state.group_rolls[date][gid][uid] = { pig_id: String(pigId), seen_at: timestamp }
  state.group_active[date] ||= {}
  state.group_active[date][gid] ||= {}
  state.group_active[date][gid][uid] = timestamp
}

export const touchGroupActive = (date, groupId, userId, name) => {
  if (!groupId) return
  return mutateState(state => {
    const gid = String(groupId)
    const uid = String(userId)
    const timestamp = nowIso()
    state.group_active[date] ||= {}
    state.group_active[date][gid] ||= {}
    state.group_active[date][gid][uid] = timestamp
    if (name) {
      state.user_names ||= {}
      state.user_names[uid] = String(name)
    }
  })
}

/**
 * 原子创建或读取某天的抽取。重复查看不会加次数，也不会改快照。
 * @returns {Promise<{created:boolean, pig_id?:string, snapshot?:object, missing?:boolean}>}
 */
export const getOrCreateDailyRoll = ({
  userId,
  officialPigs,
  date = todayStr(),
  pigId = '',
  groupId = '',
  makeup = false
}) => mutateState(state => {
  const uid = String(userId)
  const targetDate = String(date || todayStr())
  if (makeup && targetDate !== yesterdayStr()) {
    throw new Error('只能补签昨天的小猪')
  }

  state.history[targetDate] ||= {}
  const existingPigId = state.history[targetDate][uid]
  if (existingPigId) {
    if (groupId && !makeup) recordGroupRoll(state, targetDate, groupId, uid, existingPigId)
    return {
      created: false,
      pig_id: String(existingPigId),
      snapshot: state.snapshots?.[targetDate]?.[uid] || null
    }
  }

  const proposed = pigId
    ? getPigById(officialPigs, pigId)
    : pickWeightedPig(
      officialPigs,
      ownedPigIds(uid),
      state.draw_state?.[uid]?.duplicate_streak || 0
    )
  if (!proposed) throw new Error('猪圈塌房了（数据缺失）')

  state.collection[uid] ||= []
  if (!Array.isArray(state.collection[uid])) state.collection[uid] = []
  state.pig_progress[uid] ||= {}
  if (!state.pig_progress[uid] || typeof state.pig_progress[uid] !== 'object') state.pig_progress[uid] = {}
  state.draw_state[uid] ||= { duplicate_streak: 0 }
  if (!state.draw_state[uid] || typeof state.draw_state[uid] !== 'object') state.draw_state[uid] = { duplicate_streak: 0 }

  const previousStreak = Math.max(0, Math.trunc(Number(state.draw_state[uid].duplicate_streak) || 0))
  const previous = state.pig_progress[uid][proposed.id]
  const hasProgress = previous && typeof previous === 'object'
  const alreadyCollected = state.collection[uid].includes(String(proposed.id))
  const previousCopies = hasProgress
    ? Math.max(1, Math.trunc(Number(previous.copies) || 1))
    : (alreadyCollected ? 1 : 0)
  const growthBonus = hasProgress ? Math.max(0, Math.trunc(Number(previous.growth_bonus) || 0)) : 0
  const isNewPig = previousCopies <= 0 && !alreadyCollected

  if (!alreadyCollected) state.collection[uid].push(String(proposed.id))

  let copies
  let duplicateStreak
  let firstObtainedAt
  if (isNewPig) {
    copies = 1
    duplicateStreak = 0
    firstObtainedAt = nowIso()
  } else {
    copies = previousCopies + 1
    duplicateStreak = previousStreak + 1
    firstObtainedAt = (hasProgress && previous.first_obtained_at) || null
  }

  state.pig_progress[uid][proposed.id] = {
    copies,
    growth_bonus: growthBonus,
    first_obtained_at: firstObtainedAt
  }
  state.draw_state[uid].duplicate_streak = duplicateStreak

  state.history[targetDate][uid] = String(proposed.id)
  const previousLevel = expertLevel(previousCopies, growthBonus)
  const level = expertLevel(copies, growthBonus)
  const snapshot = {
    pig_id: String(proposed.id),
    is_new_pig: isNewPig,
    previous_copies: previousCopies,
    copies,
    previous_level: previousLevel,
    level,
    collection_size: state.collection[uid].length,
    duplicate_streak_before: previousStreak,
    duplicate_streak_after: duplicateStreak,
    is_makeup: Boolean(makeup),
    source: 'daily',
    created_at: nowIso(),
    date: targetDate,
    group_id: makeup ? '' : String(groupId || '')
  }
  state.snapshots[targetDate] ||= {}
  state.snapshots[targetDate][uid] = snapshot
  if (groupId && !makeup) recordGroupRoll(state, targetDate, groupId, uid, proposed.id)

  return { created: true, pig_id: String(proposed.id), snapshot }
})

/** 解析某天的抽取结果：资源缺失时返回 missing，不伪造随机猪 */
export const resolveDailyPig = ({ userId, officialPigs, date = todayStr(), groupId = '', record = true }) => {
  const uid = String(userId)
  const pigId = getHistoryPigId(date, uid)
  if (!pigId) return { exists: false, pig: null, pigId: '', level: 0, snapshot: null }
  const pig = getPigById(officialPigs, pigId)
  if (!pig) return { exists: true, missing: true, pigId, pig: null, level: 0, snapshot: getDailySnapshot(date, uid) }
  const progress = getProgressEntry(uid, pigId)
  const level = expertLevel(progress.copies, progress.growth_bonus)
  const appearance = resolveAppearance(pig, level)
  const snapshot = getDailySnapshot(date, uid)
  if (record && groupId && date === todayStr()) {
    mutateState(state => recordGroupRoll(state, date, groupId, uid, pigId)).catch(error => {
      log().warn?.('[今天是什么小猪] 记录群抽取失败:', error)
    })
  }
  return {
    exists: true,
    missing: false,
    pig: appearance.pig,
    imagePath: appearance.imagePath,
    variantLevel: appearance.appliedLevel,
    progress,
    level,
    pigId,
    snapshot
  }
}

/** 生成成长提示；新猪/重复升级/差分升级/同等级四条分支与 plus 一致 */
export const buildGrowthText = ({ pig, postPig, snapshot, pigId }) => {
  if (!snapshot) return ''
  const name = String(postPig?.name || pig?.name || snapshot.pig_id)
  const level = Number(snapshot.level) || 0
  const previousLevel = Number(snapshot.previous_level) || 0
  if (snapshot.is_new_pig) {
    return formatText(pickText(texts.DAILY_ROLL_NEW_PIG_TEXTS), { pig: name, level })
  }
  const unlocked = newlyUnlockedVariantLevels(pigId || snapshot.pig_id, previousLevel, level)
  if (unlocked.length) {
    const fields = variantFieldsForLevels(pigId || snapshot.pig_id, unlocked)
    const hasImage = fields.includes('image')
    const hasText = fields.includes('text')
    const key = hasImage && hasText ? 'image_text' : (hasImage ? 'image' : 'text')
    const pool = texts.DAILY_ROLL_VARIANT_LEVEL_UP_TEXTS?.[key]
    const selected = pickText(pool) || pickText(texts.DAILY_ROLL_DUPLICATE_LEVEL_UP_TEXTS)
    return formatText(selected, { pig: name, level, old_level: previousLevel, new_level: level })
  }
  if (level > previousLevel) {
    return formatText(pickText(texts.DAILY_ROLL_DUPLICATE_LEVEL_UP_TEXTS), {
      pig: name,
      level,
      old_level: previousLevel,
      new_level: level
    })
  }
  return formatText(pickText(texts.DAILY_ROLL_DUPLICATE_SAME_LEVEL_TEXTS), { pig: name, level })
}

/** 昨日补签：仅在没有昨日记录时创建；使用同一保底权重 */
export const ensureYesterdayPig = async ({ userId, officialPigs }) => {
  const date = yesterdayStr()
  const existing = getHistoryPigId(date, userId)
  if (existing) return { created: false, pig_id: existing }
  if (!mergedPigs(officialPigs).length) throw new Error('小猪资源暂时不可用，无法补签')
  const result = await getOrCreateDailyRoll({
    userId,
    officialPigs,
    date,
    makeup: true,
    groupId: ''
  })
  return result
}

/** 猪圈统计：只统计当前合并库中的 id，避免文本统计与图片统计不一致 */
export const userPenStats = ({ userId, officialPigs }) => {
  const pigs = mergedPigs(officialPigs)
  const map = new Map(pigs.map(pig => [String(pig.id), pig]))
  const progress = getState().pig_progress?.[String(userId)] || {}
  let collected = 0
  let totalDraws = 0
  let bestPig = null
  let bestCount = 0
  let highestEx = 0
  for (const [pigId, entry] of Object.entries(progress)) {
    if (!entry || typeof entry !== 'object') continue
    const copies = Math.max(0, Math.trunc(Number(entry.copies) || 0))
    if (copies <= 0) continue
    totalDraws += copies
    if (!map.has(pigId)) continue
    collected++
    const level = expertLevel(copies, entry.growth_bonus)
    highestEx = Math.max(highestEx, level)
    if (copies > bestCount) {
      bestCount = copies
      bestPig = map.get(pigId)
    }
  }
  return {
    collected,
    total: pigs.length,
    percent: pigs.length ? (collected / pigs.length * 100).toFixed(2) : '0.00',
    totalDraws,
    bestPig,
    bestCount,
    highestEx
  }
}

export const penCardData = ({ userId, officialPigs }) => {
  const record = getState().pig_progress?.[String(userId)] || {}
  return mergedPigs(officialPigs).map(pig => {
    const entry = record[pig.id]
    const copies = Math.max(0, Math.trunc(Number(entry?.copies) || 0))
    const level = expertLevel(copies, entry?.growth_bonus)
    const appearance = resolveAppearance(pig, level)
    return {
      name: appearance.pig.name,
      level,
      unlocked: copies > 0,
      image: appearance.imagePath
    }
  })
}
