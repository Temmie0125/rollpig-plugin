// 普通烤猪首次成功后的“加餐”：只加 growth_bonus，不增加 copies。
import { mutateState } from '../state.js'
import { expertLevel } from '../pigs.js'
import { formatText, pickText, texts } from '../texts.js'
import { nowIso, todayStr } from '../time.js'

export const applyDailyFeed = async ({ userId, date = todayStr(), sourceType = 'roast', sourceId = '' }) =>
  mutateState(state => {
    const uid = String(userId)
    const pigId = String(state.history?.[date]?.[uid] || '')
    if (!pigId) return { status: 'no_daily_pig', userId: uid }
    state.daily_feeds ||= {}
    state.daily_feeds[date] ||= {}
    const existing = state.daily_feeds[date][uid]
    if (existing && typeof existing === 'object') {
      return {
        status: existing.source_id === sourceId ? 'fed' : 'already_fed',
        userId: uid,
        pigId: existing.pig_id || pigId,
        previousLevel: existing.previous_level || 0,
        newLevel: existing.new_level || 0
      }
    }
    state.pig_progress[uid] ||= {}
    const progress = state.pig_progress[uid][pigId]
    if (!progress || typeof progress !== 'object') return { status: 'no_daily_pig', userId: uid }
    const copies = Math.max(1, Math.trunc(Number(progress.copies) || 1))
    const bonus = Math.max(0, Math.trunc(Number(progress.growth_bonus) || 0))
    const previousLevel = expertLevel(copies, bonus)
    if (previousLevel >= 5) return { status: 'max_level', userId: uid, pigId, previousLevel, newLevel: previousLevel }
    progress.growth_bonus = bonus + 1
    const newLevel = expertLevel(copies, bonus + 1)
    const createdAt = nowIso()
    state.daily_feeds[date][uid] = {
      status: 'fed',
      pig_id: pigId,
      previous_level: previousLevel,
      new_level: newLevel,
      source_type: sourceType,
      source_id: String(sourceId),
      created_at: createdAt
    }
    return {
      status: 'fed',
      userId: uid,
      pigId,
      previousLevel,
      newLevel,
      sourceType,
      sourceId,
      createdAt
    }
  })

export const feedTextForResultWithPigName = (result, pigName) => {
  if (!result || result.status !== 'fed' || result.newLevel <= result.previousLevel) return ''
  return formatText(pickText(texts.DAILY_FEED_ROAST_TEXTS), {
    pig: pigName || result.pigId,
    old_level: result.previousLevel,
    new_level: result.newLevel
  })
}
