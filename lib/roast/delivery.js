// 预约结果投递：先固定 outcome，再发送；发送失败只重试同一条结果。
import { segment } from 'oicq'
import { pathToFileURL } from 'url'
import { listOfficialPigs } from '../custom-store.js'
import { findPigImageAny } from '../pigs.js'
import { formatText, pickText, texts } from '../texts.js'
import {
  buildReservationOutcome,
  claimBuildableReservations,
  claimSendableReservations,
  feedResultsWithNames,
  feedTextForResults,
  finalizeReservation,
  markReservationSendFailed,
  markReservationSent,
  participantsLabel,
  releaseBuildReservation,
  reservationView
} from './reservations.js'
import { pickProtectionLevelUpText } from './flow.js'

const log = () => globalThis.logger || console

const messageIdOf = result => {
  if (!result) return ''
  if (typeof result === 'string') return result
  return String(result.message_id || result.data?.message_id || result.seq || '')
}

const outcomeMessage = (outcome, reservation, feedResults, protectionUpgrade) => {
  const parts = []
  if (outcome.extraText) parts.push(String(outcome.extraText).replace(/\s+$/, ''))
  if (outcome.renderData) {
    const imagePath = findPigImageAny(outcome.renderData.id)
    if (imagePath) parts.push(segment.image(pathToFileURL(imagePath).href))
    parts.push(`【${outcome.renderData.name || '熟食'}】\n${outcome.renderData.description || ''}\n\n${outcome.renderData.analysis || ''}`)
  } else if (outcome.plainText) {
    parts.push(String(outcome.plainText))
  }

  if (protectionUpgrade?.changed) {
    parts.push(pickProtectionLevelUpText(reservation.target_name || reservation.target_id, protectionUpgrade.level))
  }
  const namedFeeds = feedResultsWithNames(feedResults, reservation)
  const feedText = feedTextForResults(namedFeeds)
  if (feedText) parts.push(feedText)
  return parts.filter(Boolean).join('\n')
}

const sendToGroup = async (groupId, message) => {
  const bot = globalThis.Bot
  if (!bot?.pickGroup) throw new Error('Bot 尚未初始化')
  const group = bot.pickGroup(Number(groupId) || groupId)
  if (!group?.sendMsg) throw new Error(`找不到群 ${groupId}`)
  return group.sendMsg(message)
}

/** 机会式投递：构建 ready 结果，再发送 ready_to_send；可重复调用 */
export const deliverReadyReservations = async ({ groupId = '' } = {}) => {
  const officialPigs = listOfficialPigs()
  const claimed = await claimBuildableReservations({ groupId })
  for (const reservation of claimed) {
    try {
      const outcome = await buildReservationOutcome(reservation, officialPigs)
      await finalizeReservation({ reservationId: reservation.reservation_id, outcome })
    } catch (error) {
      log().warn?.(`[烤猪预约] 结果生成失败，保留重试: ${reservation.reservation_id}`, error)
      await releaseBuildReservation(reservation.reservation_id)
    }
  }

  const sendable = await claimSendableReservations({ groupId })
  let sent = 0
  for (const reservation of sendable) {
    const outcome = reservation.outcome_snapshot
    if (!outcome) {
      await markReservationSendFailed(reservation.reservation_id, '缺少结果快照')
      continue
    }
    try {
      const message = outcomeMessage(
        outcome,
        reservation,
        reservation.feed_results || [],
        reservation.protection_upgrade || null
      )
      const result = await sendToGroup(reservation.group_id, message)
      await markReservationSent(reservation.reservation_id, messageIdOf(result))
      sent++
    } catch (error) {
      log().warn?.(`[烤猪预约] 发送失败: ${reservation.reservation_id}`, error)
      await markReservationSendFailed(reservation.reservation_id, error?.message || String(error))
    }
  }
  return { built: claimed.length, sent }
}

export const reservationImagePath = reservation => findPigImageAny(reservation.target_pig_id)

export const reservationNoticeFor = reservation =>
  reservation ? participantsLabel(reservationView(reservation)) : ''

/** 目标已抽猪但聚众火力不足时，向群里补一条进度提示（每个预约只提示一次） */
export const deliverWaitingNotices = async ({ groupId = '' } = {}) => {
  const { getState, mutateState } = await import('../state.js')
  const pending = Object.values(getState().reservations || {}).filter(item =>
    item && item.status === 'pending' && item.target_pig_id && item.waiting_notice &&
    (!groupId || item.group_id === String(groupId))
  )
  let sent = 0
  for (const reservation of pending) {
    const level = Math.max(1, Math.trunc(Number(reservation.protection_required) || 2) - 1)
    const current = (reservation.participants || []).reduce(
      (sum, item) => sum + Math.max(1, Math.trunc(Number(item.contribution) || 1)),
      0
    )
    const required = Math.max(1, Math.trunc(Number(reservation.protection_required) || 2))
    const pool = current >= required ? texts.PROTECTED_ROAST_READY_PROGRESS_TEXTS : texts.PROTECTED_ROAST_PROGRESS_TEXTS
    const text = formatText(pickText(pool), { level, current, required })
    try {
      await sendToGroup(reservation.group_id, text)
      await mutateState(state => {
        const target = state.reservations?.[reservation.reservation_id]
        if (target) target.waiting_notice = false
      })
      sent++
    } catch (error) {
      log().warn?.(`[烤猪预约] 等待提示发送失败: ${reservation.reservation_id}`, error)
    }
  }
  return sent
}
