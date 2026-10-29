// 猪圈日报主动查卡 + 小猪日报推送开关。
import {
  isReportEnabled,
  queryLatestReport,
  reportStatus,
  setReportEnabled
} from '../report/job.js'
import { groupContext, isGroupManager, isMaster, touchContext, userName } from './helpers.js'

export const reportQuery = async (plugin, e) => {
  const { groupId } = groupContext(e)
  if (!groupId) {
    await e.reply('请在群里发送「猪圈日报」。')
    return true
  }
  await touchContext(e, e.user_id, userName(e))
  let result
  try {
    result = await queryLatestReport({ groupId })
  } catch (error) {
    ;(globalThis.logger || console).error?.('[猪圈日报] 查卡失败:', error)
    await e.reply('猪圈日报暂时查不到，请稍后再试。')
    return true
  }
  if (result.status === 'publishing') {
    await e.reply('本期日报正在出刊，00:10 后再来翻报纸。')
    return true
  }
  if (result.status === 'empty') {
    await e.reply('这期猪圈休刊，没攒出一张日报。')
    return true
  }
  const send = async image => {
    const parts = [image]
    if (result.unconfirmed) parts.push('次日保护结算暂未确认。')
    await e.reply(parts)
  }
  try {
    await send(result.image)
  } catch (error) {
    try {
      const retry = await queryLatestReport({ groupId, force: true })
      if (retry.status === 'ok') await send(retry.image)
      else throw error
    } catch (retryError) {
      ;(globalThis.logger || console).error?.('[猪圈日报] 查卡重试失败:', retryError)
      await e.reply('猪圈日报暂时查不到，请稍后再试。')
    }
  }
  return true
}

const parseSwitch = msg => {
  const match = String(msg || '').match(/^#?(小猪日报|每日总结设置|rollpig日报)\s*(.*)$/)
  const tokens = String(match?.[2] || '').split(/\s+/).filter(Boolean)
  let action = 'status'
  let groupId = ''
  for (const token of tokens) {
    const value = token.toLowerCase()
    if (['开启', '打开', '启用', '开', 'on', 'enable', 'true'].includes(value)) action = 'enable'
    else if (['关闭', '停用', '关', 'off', 'disable', 'false'].includes(value)) action = 'disable'
    else if (['状态', '查看', '查询', 'status', 'info'].includes(value)) action = 'status'
    else if (/^\d+$/.test(token)) groupId = token
  }
  return { action, groupId }
}

const statusText = (groupId, config) => {
  const status = reportStatus(groupId, config)
  const source = status.source === 'group' ? '群设置' : '全局默认'
  return [
    `📰 本群日报推送：${status.enabled ? '已开启' : '已关闭'}（${source}）`,
    '定时推送：每天 23:45（上海时间）',
    '主动查卡：发送「猪圈日报」'
  ].join('\n')
}

export const reportSwitch = async (plugin, e) => {
  const { groupId: currentGroup } = groupContext(e)
  const parsed = parseSwitch(e.msg)
  const targetGroup = parsed.groupId || currentGroup
  if (!targetGroup) {
    await e.reply('请在群内使用，或由主人指定群号：小猪日报 开启 123456')
    return true
  }
  const master = isMaster(e)
  const selfGroupManager = currentGroup && String(currentGroup) === String(targetGroup) && isGroupManager(e)
  if (!master && !selfGroupManager) {
    await e.reply('只有群主/管理员可以修改本群日报推送；指定其他群需要 Bot 主人权限。')
    return true
  }
  if (parsed.action === 'status') {
    await e.reply(statusText(targetGroup, plugin.config))
    return true
  }
  const enabled = parsed.action === 'enable'
  await setReportEnabled(targetGroup, enabled)
  await e.reply([
    `📰 群 ${targetGroup} 的日报推送已${enabled ? '开启' : '关闭'}`,
    enabled ? '今晚 23:45 起会尝试推送本群日报。' : '关闭推送不影响群友主动发送「猪圈日报」查卡。'
  ].join('\n'))
  return true
}

export const currentReportEnabled = (groupId, config) => isReportEnabled(groupId, config)
