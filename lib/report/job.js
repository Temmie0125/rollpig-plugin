// 猪圈日报定时推送、次日保护结算、主动查卡。
import { readConfig } from '../app-config.js'
import { getState, mutateState } from '../state.js'
import {
  addDays,
  dailyReportRecoveryDate,
  latestReportQueryDate,
  nowIso,
  reportCutoffIso,
  shanghaiClock,
  todayStr
} from '../time.js'
import { listOfficialPigs } from '../custom-store.js'
import { settleProtections } from '../roast/protection.js'
import { groupEventsForReport, loadGroupReport, reportActiveGroups } from './load.js'
import { renderReportCard } from './render.js'

const log = () => globalThis.logger || console
const QUERY_CACHE = new Map()
const QUERY_CACHE_MS = 300 * 1000
const QUERY_CACHE_UNCONFIRMED_MS = 30 * 1000
let running = false

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

const botUserIds = () => {
  const ids = new Set()
  const bot = globalThis.Bot
  for (const id of bot?.uin || []) ids.add(String(id))
  for (const id of Object.keys(bot?.bots || {})) ids.add(String(id))
  return [...ids]
}

export const isReportEnabled = (groupId, config = readConfig()) => {
  const value = getState().report_groups?.[String(groupId)]
  if (typeof value === 'boolean') return value
  return Boolean(config.dailyReportDefault)
}

export const setReportEnabled = async (groupId, enabled) => mutateState(state => {
  state.report_groups ||= {}
  state.report_groups[String(groupId)] = Boolean(enabled)
  return Boolean(enabled)
})

export const reportStatus = (groupId, config = readConfig()) => {
  const value = getState().report_groups?.[String(groupId)]
  const source = typeof value === 'boolean' ? 'group' : 'default'
  return {
    enabled: typeof value === 'boolean' ? value : Boolean(config.dailyReportDefault),
    source
  }
}

const deliveryOf = (date, groupId) => getState().report_deliveries?.[date]?.[String(groupId)] || null

const setDelivery = async (date, groupId, patch) => mutateState(state => {
  state.report_deliveries ||= {}
  state.report_deliveries[date] ||= {}
  const previous = state.report_deliveries[date][String(groupId)] || { attempts: 0 }
  const next = {
    ...previous,
    ...patch,
    attempts: patch.attempts ?? previous.attempts ?? 0,
    updated_at: nowIso()
  }
  state.report_deliveries[date][String(groupId)] = next
  return next
})

const pickGroup = groupId => {
  const bot = globalThis.Bot
  if (!bot?.pickGroup) return null
  try {
    return bot.pickGroup(groupId, true) || bot.pickGroup(groupId)
  } catch {
    return null
  }
}

const deliverOne = async ({ date, groupId, cutoffIso, cutoffTime, officialPigs }) => {
  const state = deliveryOf(date, groupId)
  if (state) {
    if (['sent', 'skipped', 'uncertain'].includes(state.status)) return false
    if (state.status === 'sending') {
      const updated = Date.parse(state.updated_at || '') || 0
      if (Date.now() - updated < 10 * 60 * 1000) return false
      await setDelivery(date, groupId, { status: 'uncertain', error: 'sending_timeout' })
      return false
    }
  }
  const group = pickGroup(groupId)
  if (!group) {
    await setDelivery(date, groupId, { status: 'failed', error: 'bot_not_in_group' })
    return false
  }
  await setDelivery(date, groupId, {
    status: 'sending',
    attempts: (state?.attempts || 0) + 1,
    error: ''
  })
  try {
    const { report } = await loadGroupReport({
      groupId,
      date,
      cutoffIso,
      officialPigs,
      botUserIds: botUserIds()
    })
    if (!report.has_activity) {
      await setDelivery(date, groupId, { status: 'skipped' })
      return false
    }
    const image = await renderReportCard({ report, officialPigs, cutoffTime })
    const result = await group.sendMsg(image)
    await setDelivery(date, groupId, {
      status: 'sent',
      message_id: String(result?.message_id || result?.data?.message_id || '')
    })
    return true
  } catch (error) {
    log().warn?.(`[猪圈日报] 群推送失败 group=${groupId}:`, error)
    await setDelivery(date, groupId, { status: 'failed', error: String(error?.message || error).slice(0, 300) })
    return false
  }
}

const inDeliveryWindow = () => {
  const { minutes } = shanghaiClock()
  return minutes >= 23 * 60 + 45 || minutes < 10
}


/**
 * 23:45 上海时间触发；data 截止固定 23:45，随机延迟 0-600 秒，失败重试到次日 00:10。
 * 关闭日报推送的群仍会结算次日保护。
 */
export const runDailyReportJob = async ({ reportDate = '', randomDelay = true } = {}) => {
  if (running) return { skipped: 'already_running' }
  running = true
  try {
    const config = readConfig()
    const date = reportDate || todayStr()
    const protectDate = addDays(date, 1)
    const cutoffIso = reportCutoffIso(date)
    const cutoffTime = '23:45'
    const delay = randomDelay ? Math.floor(Math.random() * 600) : 0
    if (delay) {
      log().info?.(`[猪圈日报] ${date} 延迟 ${delay} 秒后推送`)
      await sleep(delay * 1000)
    }

    const activeGroups = reportActiveGroups(date)
    if (!activeGroups.length) {
      log().info?.(`[猪圈日报] ${date} 无活跃群，跳过`)
      return { activeGroups: 0 }
    }
    const eventsByGroup = {}
    for (const groupId of activeGroups) {
      eventsByGroup[groupId] = groupEventsForReport({ date, groupId, cutoffIso })
    }
    await settleProtections({ date, groups: activeGroups, eventsByGroup, cutoffIso })
    log().info?.(`[猪圈日报] ${date} 次日保护已结算群数=${activeGroups.length}, protectDate=${protectDate}`)

    const pushGroups = activeGroups.filter(groupId => isReportEnabled(groupId, config))
    if (!pushGroups.length) {
      log().info?.('[猪圈日报] 没有群开启日报推送')
      return { activeGroups: activeGroups.length, pushGroups: 0 }
    }

    const officialPigs = listOfficialPigs()
    let sent = 0
    for (const groupId of pushGroups) {
      if (!inDeliveryWindow()) break
      if (await deliverOne({ date, groupId, cutoffIso, cutoffTime, officialPigs })) sent++
    }

    let failed = pushGroups.filter(groupId => {
      const state = deliveryOf(date, groupId)
      return state && !['sent', 'skipped', 'uncertain'].includes(state.status)
    })
    while (failed.length && inDeliveryWindow()) {
      await sleep(30_000)
      for (const groupId of failed) {
        if (!inDeliveryWindow()) break
        if (await deliverOne({ date, groupId, cutoffIso, cutoffTime, officialPigs })) sent++
      }
      failed = failed.filter(groupId => {
        const state = deliveryOf(date, groupId)
        return state && !['sent', 'skipped', 'uncertain'].includes(state.status)
      })
    }
    log().info?.(`[猪圈日报] ${date} 推送完成，成功 ${sent}/${pushGroups.length}`)
    return { activeGroups: activeGroups.length, pushGroups: pushGroups.length, sent }
  } catch (error) {
    log().error?.('[猪圈日报] 任务异常:', error)
    return { error: String(error?.message || error) }
  } finally {
    running = false
  }
}

/** 启动/定时恢复：只在 23:45-00:10 窗口内补跑；delivery 状态负责防重 */
export const runDailyReportRecovery = async () => {
  const date = dailyReportRecoveryDate()
  if (!date) return false
  const state = getState().report_deliveries?.[date] || {}
  if (Object.values(state).every(item => ['sent', 'skipped', 'uncertain'].includes(item.status))) return false
  await runDailyReportJob({ reportDate: date, randomDelay: false })
  return true
}

/** 主动查卡：只读重建最近一期封版日报 */
export const queryLatestReport = async ({ groupId, force = false }) => {
  const date = latestReportQueryDate()
  if (!date) return { status: 'publishing' }
  const key = `${date}|${groupId}`
  const cached = QUERY_CACHE.get(key)
  if (!force && cached && cached.expires > Date.now()) {
    return { status: 'ok', image: cached.image, unconfirmed: cached.unconfirmed, date }
  }
  const officialPigs = listOfficialPigs()
  const { report, unconfirmed } = await loadGroupReport({
    groupId,
    date,
    cutoffIso: reportCutoffIso(date),
    officialPigs,
    botUserIds: botUserIds()
  })
  if (!report.has_activity) return { status: 'empty', date }
  const image = await renderReportCard({ report, officialPigs, cutoffTime: '23:45' })
  const ttl = unconfirmed ? QUERY_CACHE_UNCONFIRMED_MS : QUERY_CACHE_MS
  QUERY_CACHE.set(key, { image, unconfirmed, expires: Date.now() + ttl })
  if (QUERY_CACHE.size > 12) {
    const oldest = [...QUERY_CACHE.entries()].sort((a, b) => a[1].expires - b[1].expires)[0]
    if (oldest) QUERY_CACHE.delete(oldest[0])
  }
  return { status: 'ok', image, unconfirmed, date }
}
