// 今日小猪 / 明日小猪 / 昨日小猪 / 猪圈 / Markdown 开关
import path from 'path'
import { pathToFileURL } from 'url'
import { updateConfig } from '../app-config.js'
import {
  buildGrowthText,
  ensureYesterdayPig,
  getHistoryPigId,
  getOrCreateDailyRoll,
  getProgressEntry,
  penCardData,
  userPenStats
} from '../daily.js'
import {
  expertLevel,
  findPigImageAny,
  getPigById,
  resolveAppearance
} from '../pigs.js'
import { pickText, texts } from '../texts.js'
import { todayStr, yesterdayStr } from '../time.js'
import { buildFontCss, penTemplate, renderSegment, uniqueSaveId } from '../render.js'
import { buildYesterdayRecap } from '../yesterday.js'
import { renderYesterdayCard } from '../yesterday-render.js'
import { activateReservationsForTarget } from '../roast/reservations.js'
import { deliverReadyReservations, deliverWaitingNotices } from '../roast/delivery.js'
import {
  atSegment,
  drawButtons,
  groupContext,
  imageSegment,
  isQQBot,
  penButtons,
  touchContext,
  userName
} from './helpers.js'
import { PLUGIN_ROOT } from '../custom-store.js'

const MISSING = '你的今日小猪已经抽出来了，但当前 Bot 的小猪资源暂时缺失，请稍后再试。'

const replyDraw = async (plugin, e, { pig, appearance, imagePath: providedImage, level, hint }) => {
  const title = level > 0 ? `${appearance.name || pig.name} EX Lv.${level}` : (appearance.name || pig.name)
  const imagePath = providedImage || appearance.imagePath || findPigImageAny(pig.id)
  const button = drawButtons()
  if (plugin.config.markdown && isQQBot(e) && imagePath) {
    const quote = String(appearance.analysis || '').split('\n').map(line => `> ${line}`).join('\n')
    const message = [
      imageSegment(imagePath),
      `\n${hint}\n**【${title}】**\n${appearance.description || ''}\n${quote}`
    ]
    if (button) message.push(button)
    await e.reply(message)
    return
  }
  if (!imagePath) {
    await e.reply(`${hint}\n【${title}】\n${appearance.description || ''}\n${appearance.analysis || ''}`)
    return
  }
  await e.reply([
    imageSegment(imagePath),
    `\n${hint}\n【${title}】\n${appearance.description || ''}\n\n${appearance.analysis || ''}`
  ])
}

export const todayPig = async (plugin, e) => {
  const userId = String(e.user_id)
  const { groupId } = groupContext(e)
  const name = userName(e)
  await touchContext(e, userId, name)
  const date = todayStr()
  let result
  try {
    result = await getOrCreateDailyRoll({
      userId,
      officialPigs: plugin.pigData,
      date,
      groupId
    })
  } catch (error) {
    await e.reply(error?.message || '猪圈账本暂时无法写入，请稍后再试。')
    return true
  }
  const pig = getPigById(plugin.pigData, result.pig_id)
  if (!pig) {
    await e.reply(MISSING)
    return true
  }
  const progress = getProgressEntry(userId, pig.id)
  const level = expertLevel(progress.copies, progress.growth_bonus)
  const appearance = resolveAppearance(pig, level)
  const hint = result.created
    ? buildGrowthText({ pig, postPig: appearance.pig, snapshot: result.snapshot, pigId: pig.id })
    : '今天已经抽过啦，这是你的今日小猪~'
  await replyDraw(plugin, e, { pig, appearance: appearance.pig, imagePath: appearance.imagePath, level, hint })
  if (result.created) {
    await activateReservationsForTarget({ targetId: userId, targetPigId: pig.id, date })
    await deliverReadyReservations({})
    await deliverWaitingNotices({})
  }
  return true
}

export const tomorrowPig = async (e) => {
  await touchContext(e)
  await e.reply(pickText(texts.TOMORROW_TEXTS))
  return true
}

export const yesterdayPig = async (plugin, e) => {
  const userId = String(e.user_id)
  const { groupId } = groupContext(e)
  await touchContext(e, userId, userName(e))
  const date = yesterdayStr()
  let recap = buildYesterdayRecap({ userId, groupId, date })
  let makeupCreated = false
  if (!recap) {
    try {
      const result = await ensureYesterdayPig({ userId, officialPigs: plugin.pigData })
      makeupCreated = Boolean(result.created)
      recap = buildYesterdayRecap({ userId, groupId, date })
    } catch (error) {
      await e.reply(error?.message || '小猪资源暂时不可用，无法补签。')
      return true
    }
  }
  if (!recap) {
    await e.reply('补签结果暂时无法读取，请稍后再试。')
    return true
  }
  try {
    const image = await renderYesterdayCard(recap)
    const prefix = makeupCreated ? pickText(texts.YESTERDAY_MAKEUP_TEXTS) : ''
    await e.reply(prefix ? [prefix, image] : image)
  } catch (error) {
    ;(globalThis.logger || console).error?.('[昨日小猪] 卡片渲染失败:', error)
    const lines = [
      `【昨日小猪】${recap.pig_name}`,
      recap.outcome_text,
      ...(recap.experiences || []).map(item => `• ${item.text}`),
      recap.summary?.text || '',
      recap.aftereffect_text || ''
    ].filter(Boolean)
    await e.reply(lines.join('\n'))
  }
  return true
}

const getUserNickname = (e, userId) => userName(e, userId) || (String(e.user_id) === String(userId) ? '你' : 'TA')

const penHeader = (e, userId) => {
  if (e.isGroup || e.group) return ['【', atSegment(userId), ' 的猪圈】']
  return [`【${getUserNickname(e, userId)}的猪圈】`]
}

export const pigPen = async (plugin, e) => {
  let userId = String(e.user_id)
  let isSelf = true
  let at = e.at ? String(e.at) : null
  if (at && at === String(e.self_id)) at = null
  if (String(e.platform || '').startsWith('guild')) at = null
  if (at && at !== userId) {
    userId = at
    isSelf = false
  }
  await touchContext(e, e.user_id, userName(e))
  const stats = userPenStats({ userId, officialPigs: plugin.pigData })
  if (!stats.collected) {
    await e.reply(isSelf
      ? '你的猪圈还空空如也，快发送 #今日小猪 抽一只猪猪吧~'
      : 'TA的猪圈还空空如也，让TA发送 #今日小猪 抽一只猪猪吧~')
    return true
  }
  const header = penHeader(e, userId)
  const lines = [
    `📦 已收集: ${stats.collected} / ${stats.total}`,
    `⭐ 收集率: ${stats.percent}%`,
    `🏅 最高 EX: Lv.${stats.highestEx}`
  ]
  if (stats.bestPig) lines.push(`🐷 本命猪: 【${stats.bestPig.name}】×${stats.bestCount}`)
  try {
    const cards = penCardData({ userId, officialPigs: plugin.pigData }).map(card => ({
      ...card,
      image: pathToFileURL(card.image || path.join(PLUGIN_ROOT, 'resource', 'image', 'pig.png')).href
    }))
    const total = cards.length
    const columns = Math.min(14, Math.max(4, Math.ceil(Math.sqrt(total * 0.9))))
    const penWidth = columns * 150 + 80
    const titleSize = Math.min(88, Math.max(48, Math.round(penWidth / 10)))
    const image = await renderSegment({
      name: 'rollpig-pen',
      tplFile: penTemplate,
      saveId: uniqueSaveId('rollpig-pen'),
      data: {
        fontCss: buildFontCss(),
        collected: stats.collected,
        total,
        percent: stats.percent,
        totalDraws: stats.totalDraws,
        columns,
        penWidth,
        titleSize,
        pigs: cards
      }
    })
    const message = [...header, `\n${lines.join('\n')}\n`, image]
    const button = penButtons()
    if (plugin.config.markdown && isQQBot(e) && button) message.push(button)
    await e.reply(message)
  } catch (error) {
    ;(globalThis.logger || console).error?.('[猪圈] 渲染失败:', error)
    await e.reply([...header, `\n${lines.join('\n')}`])
  }
  return true
}

export const setMarkdown = async (plugin, e) => {
  const on = /开启|on/i.test(e.msg)
  updateConfig({ markdown: on })
  plugin.config.markdown = on
  await e.reply(`Markdown回复已${on ? '开启' : '关闭'}${on ? '，官方QQBot将使用Markdown格式回复' : ''}`)
  return true
}

export { replyDraw, MISSING }
