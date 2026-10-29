// 日报业务快照 → HTML 视图模型。文案模板、强调词和素材选择与 plus 的卡片数据层保持一致。
import fs from 'fs'
import { getPigById, resolveAppearance } from '../pigs.js'
import { assetUrl, fileUrl } from '../render.js'
import { stablePick, texts } from '../texts.js'
import {
  isReservation,
  reservationPartySize,
  resultKind
} from './build.js'

const STAT_ASSETS = {
  roll_count: 'stats_people.png',
  ordinary_roast: 'stats_flame.png',
  reservation: 'stats_calendar.png',
  escape: 'stats_escape.png',
  backfire: 'stats_backfire.png',
  pig_variety: 'stats_pig_variety.png'
}
const OBSERVATION_ASSETS = {
  reservation: 'observation_reservation.png',
  backfire: 'observation_backfire.png',
  escape: 'observation_escape.png',
  success: 'observation_roast_success.png',
  human: 'observation_human.png',
  collision: 'observation_collision.png',
  variety: 'observation_variety.png'
}
const HEADLINE_ASSETS = {
  normal_success: 'headline_roast_success.png',
  normal_escape: 'headline_escape.png',
  normal_backfire: 'headline_backfire.png',
  self_roast: 'headline_self_roast.png',
  bot_backfire: 'headline_bot_backfire.png',
  reservation_success: 'headline_reservation_success.png',
  reservation_escape: 'headline_reservation_escape.png',
  reservation_backfire: 'headline_reservation_backfire.png',
  reservation_human: 'headline_reservation_human.png',
  reservation_food: 'headline_reservation_food.png',
  reservation_eaten: 'headline_reservation_eaten.png',
  reservation_sold: 'headline_reservation_sold.png'
}
const TIMELINE_ASSETS = {
  success: 'event_fire.png',
  escape: 'event_run.png',
  backfire: 'event_angry.png',
  bot_backfire: 'event_angry.png',
  reservation: 'event_reservation.png',
  special: 'event_special_target.png'
}
const RANKING_TITLES = {
  expert_level: '严选好猪',
  roast_success: '烧烤狂人',
  catalog: '养猪大户'
}

const esc = value => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;')

const richValue = value => {
  if (value && typeof value === 'object') {
    const raw = esc(value.text)
    if (value.accent && value.bold) return `<span class="accent bold">${raw}</span>`
    if (value.accent) return `<span class="accent">${raw}</span>`
    if (value.bold) return `<span class="bold">${raw}</span>`
    return raw
  }
  return esc(value)
}

const richTemplate = (template, values) => String(template || '')
  .replace(/\{([a-z][a-z0-9_]*)\}/g, (match, key) =>
    Object.prototype.hasOwnProperty.call(values, key) ? richValue(values[key]) : match
  )
  .replace(/\n/g, '<br>')

const stableTemplate = (report, section, kind, identity, pool) => {
  if (!Array.isArray(pool) || !pool.length) throw new Error(`日报文案池为空: ${section}/${kind}`)
  return stablePick(pool, report.date_str, report.group_id, section, kind, identity)
}

const reportName = (report, userId, fallback = '') =>
  report.display_names?.[userId] || fallback || userId || '神秘人'

const pigName = (report, pigId) => {
  const id = String(pigId || '')
  if (!id) return '未知小猪'
  const pig = getPigById(report.officialPigs, id)
  return pig?.name || id
}

const observationBreakdown = selection => {
  const parts = []
  for (const [label, count] of [
    ['成功', selection.success_count || 0],
    ['逃脱', selection.escape_count || 0],
    ['反噬', selection.backfire_count || 0]
  ]) {
    if (count) parts.push(`${label} ${count} 场`)
  }
  const regular = (selection.success_count || 0) + (selection.escape_count || 0) + (selection.backfire_count || 0)
  const special = Math.max(0, (selection.matched || 0) - regular)
  if (special) parts.push(`特殊目标 ${special} 场`)
  return parts.length ? parts.join('、') : '各场结果没有形成明显倾向'
}

const observationCard = report => {
  const selection = report.observation
  if (!selection) return null
  const overview = report.overview
  const reservations = report.events.filter(isReservation)
  const protectedCount = reservations.filter(event => event.protection_level > 0 && event.force_mode !== 'super').length
  const backfires = report.events.filter(event => resultKind(event) === 'backfire')
  const victimCount = backfires.reduce((sum, event) => sum + Math.max(1, new Set(event.backfire_victim_ids).size), 0)
  let templateKind = selection.kind
  if (selection.kind === 'reservation' && protectedCount) templateKind = 'protected_reservation'
  else if (selection.kind === 'backfire' && backfires.some(event => new Set(event.backfire_victim_ids).size > 1)) templateKind = 'multi_backfire'
  const resultText = {
    success: '烤成了',
    escape: '跑了',
    backfire: '把自己烤了'
  }[selection.dominant_result] || '结果各不相同'
  const identity = [
    selection.total, selection.matched, selection.success_count, selection.escape_count,
    selection.backfire_count, overview.top_pig_id, overview.top_pig_count
  ].join(':')
  const template = stableTemplate(report, 'observation', templateKind, identity, texts.DAILY_REPORT_OBSERVATION_TEXTS[templateKind])
  const html = richTemplate(template, {
    total: { text: templateKind === 'protected_reservation' ? reservations.length : selection.total, bold: true },
    protected: { text: protectedCount, accent: true, bold: true },
    success: { text: selection.success_count || 0, accent: true, bold: true },
    escape: { text: selection.escape_count || 0, accent: true, bold: true },
    backfire: { text: selection.backfire_count || 0, accent: true, bold: true },
    rounds: { text: backfires.length, bold: true },
    victims: { text: victimCount, accent: true, bold: true },
    matched: { text: selection.matched || 0, accent: true, bold: true },
    result: { text: resultText, accent: true, bold: true },
    breakdown: { text: observationBreakdown(selection), accent: true },
    roll_count: { text: overview.roll_count, bold: true },
    variety_count: { text: overview.pig_variety_count, accent: true, bold: true },
    top_pig: { text: pigName(report, overview.top_pig_id), accent: true, bold: true },
    top_count: { text: overview.top_pig_count, accent: true, bold: true }
  })
  return { asset: assetUrl('report', OBSERVATION_ASSETS[selection.kind]), html }
}

const reservationSize = event => {
  const total = reservationPartySize(event)
  return { joined: Math.max(0, total - 1), total }
}

const isForceTakeover = event => Boolean(
  event.force_mode === 'super' && isReservation(event) && (
    (event.reservation_owner_id && event.reservation_owner_id !== event.attacker_id) ||
    reservationPartySize(event) > 1
  )
)

const eventPeopleLabel = (report, event, victims = false) => {
  const ids = victims ? event.backfire_victim_ids : event.participant_ids
  const names = victims ? event.backfire_victim_names : event.participant_names
  const labels = {}
  ids.forEach((userId, index) => {
    labels[userId] = reportName(report, userId, names[index] || '')
  })
  if (!victims) {
    const ownerId = event.reservation_owner_id || event.attacker_id
    const ownerName = event.reservation_owner_name || event.attacker_name
    if (ownerId && !labels[ownerId]) {
      const withOwner = {}
      withOwner[ownerId] = reportName(report, ownerId, ownerName)
      Object.assign(withOwner, labels)
      Object.keys(labels).forEach(key => delete labels[key])
      Object.assign(labels, withOwner)
    }
  }
  const values = Object.values(labels)
  if (!values.length) return reportName(report, event.attacker_id, event.attacker_name)
  const total = victims ? values.length : Math.max(values.length, reservationPartySize(event))
  const shown = values.slice(0, 2).join('、')
  return total > Math.min(2, values.length) ? `${shown}等 ${total} 人` : shown
}

const headlineTags = (kind, event) => {
  const { total } = isReservation(event) ? reservationSize(event) : { total: 0 }
  if (kind === 'normal_success') return [event.force_mode === 'super' ? '强行点火' : '普通烤猪', '成功出餐']
  if (kind === 'normal_escape') return ['普通烤猪', '目标逃脱']
  if (kind === 'normal_backfire') return ['普通烤猪', '当场翻车']
  if (kind === 'self_roast') return ['主动自烤', '自觉上桌']
  if (kind === 'bot_backfire') return ['挑战 Bot', '当场伏诛']
  const sizeTag = total >= 6 ? '大型预约' : '预约烤猪'
  const countTag = kind === 'reservation_food' ? `${total} 人围观` : `${total} 人参与`
  const resultTag = {
    reservation_success: '成功出餐',
    reservation_escape: '集体扑空',
    reservation_backfire: '意外走火',
    reservation_human: '人类形态',
    reservation_food: '早已熟透',
    reservation_eaten: '已经吃掉',
    reservation_sold: '已经售出'
  }[kind] || '预约烤猪'
  if (kind === 'reservation_food') return ['预约烤猪', countTag, resultTag]
  return [sizeTag, countTag, resultTag]
}

const headlineCard = report => {
  const selection = report.headline
  if (!selection) return null
  const event = selection.event
  const attacker = reportName(report, event.attacker_id, event.attacker_name)
  const target = reportName(report, event.target_id, event.target_name)
  let victim = reportName(report, event.backfire_victim_id || event.attacker_id, event.backfire_victim_name || event.attacker_name)
  if (event.backfire_victim_ids.length > 1) victim = `${victim}等 ${event.backfire_victim_ids.length} 人`
  let food = String(event.food || '今日出餐').replace(/\s+/g, ' ').trim()
  if ([...food].length > 10) food = `${[...food].slice(0, 9).join('')}…`
  const { joined, total } = isReservation(event) ? reservationSize(event) : { joined: 0, total: 0 }
  const opening = joined
    ? `${attacker}召集 ${joined} 名群友围住${target}`
    : `${attacker}独自守着预约烤架等到${target}`
  const teamSubject = joined ? `${attacker}和另外 ${joined} 名群友` : `${attacker}独自`
  const team = joined ? `由${attacker}带队的 ${total} 人预约队伍` : `${attacker}的单人预约`
  let kind = selection.kind
  let tags = headlineTags(kind, event)
  const participants = eventPeopleLabel(report, event)
  const victims = eventPeopleLabel(report, event, true)
  if (event.force_mode === 'super' && event.event_type === 'success') {
    if (isForceTakeover(event)) {
      kind = 'super_takeover'
      tags = ['强行点火', '半路接管', '强制出餐']
    } else if (event.protection_level) {
      kind = 'super_protected'
      tags = ['强行点火', '无视保护', '强制出餐']
    } else {
      tags = ['强行点火', '强制出餐']
    }
  } else if (isReservation(event) && event.event_type === 'success' && event.protection_level) {
    kind = 'protection_break'
    tags = ['聚众烤猪', `${total} 人围攻`, `突破 Lv.${event.protection_level}`]
  } else if (isReservation(event) && event.event_type === 'backfire' && new Set(event.backfire_victim_ids).size > 1) {
    kind = 'multi_backfire'
    tags = ['预约烤猪', `${total} 人参与`, '连环走火']
  }
  const identity = `${event.event_id}:${total}:${food}:${victim}`
  const template = stableTemplate(report, 'headline', kind, identity, texts.DAILY_REPORT_HEADLINE_TEXTS[kind])
  const html = richTemplate(template, {
    attacker: { text: attacker, bold: true },
    target: { text: target, bold: true },
    victim: { text: victim, bold: true },
    food: { text: food, accent: true, bold: true },
    success: { text: '被烤了', accent: true, bold: true },
    escape: { text: '溜了', accent: true, bold: true },
    backfire: { text: '被烤了', accent: true, bold: true },
    self_result: { text: '自烤', accent: true, bold: true },
    human_state: { text: '人类形态', accent: true, bold: true },
    food_state: { text: '熟食', accent: true, bold: true },
    eaten_state: { text: '被吃掉', accent: true, bold: true },
    sold_state: { text: '售出', accent: true, bold: true },
    opening: { text: opening },
    team_subject: { text: teamSubject },
    team: { text: team },
    forks: { text: `${total} 把烤叉`, bold: true },
    participants: { text: participants, bold: true },
    victims: { text: victims, bold: true },
    operator: { text: attacker, bold: true },
    before: { text: event.protection_level, accent: true, bold: true },
    pig: { text: pigName(report, report.group_rolls[event.target_id]), bold: true }
  })
  return { asset: assetUrl('report', HEADLINE_ASSETS[selection.kind]), html, tags }
}

const timelineEventDetail = (report, event) => {
  const attacker = esc(reportName(report, event.attacker_id, event.attacker_name))
  const target = esc(reportName(report, event.target_id, event.target_name))
  let victim = esc(reportName(report, event.backfire_victim_id || event.attacker_id, event.backfire_victim_name || event.attacker_name))
  if (event.backfire_victim_ids.length > 1) victim = `${victim}等 ${event.backfire_victim_ids.length} 人`
  const details = []
  if (event.event_type === 'success' && event.protection_level) {
    if (isForceTakeover(event)) {
      details.push(texts.DAILY_REPORT_TIMELINE_DETAIL_TEXTS.super_takeover[0].replace('{operator}', () => attacker))
    } else if (event.force_mode !== 'super') {
      details.push(texts.DAILY_REPORT_TIMELINE_DETAIL_TEXTS.protection_break[0]
        .replace('{target}', () => target).replace('{before}', event.protection_level))
    }
    if (event.protection_level < 5) {
      details.push(texts.DAILY_REPORT_TIMELINE_DETAIL_TEXTS.protection_upgrade[0]
        .replace('{target}', () => target).replace('{after}', event.protection_level + 1))
    }
  } else if (event.event_type === 'escape' && event.protection_level) {
    details.push(texts.DAILY_REPORT_TIMELINE_DETAIL_TEXTS.protected_escape[0]
      .replace('{target}', () => target).replace('{level}', event.protection_level))
  } else if (event.event_type === 'success' && isForceTakeover(event)) {
    details.push(texts.DAILY_REPORT_TIMELINE_DETAIL_TEXTS.super_takeover[0].replace('{operator}', () => attacker))
  } else if (event.event_type === 'backfire' && new Set(event.backfire_victim_ids).size > 1) {
    details.push(texts.DAILY_REPORT_TIMELINE_DETAIL_TEXTS.multi_backfire[0]
      .replace('{count}', new Set(event.backfire_victim_ids).size))
  }
  if (details.length) return details.join('\n')
  let kind
  if (event.event_type === 'self_roast') kind = 'self_roast'
  else if (event.event_type === 'success') kind = isReservation(event) ? 'reservation_success' : 'normal_success'
  else if (event.event_type === 'escape') kind = 'escape'
  else if (event.event_type === 'bot_backfire') kind = 'bot_backfire'
  else if (event.event_type === 'backfire') kind = 'backfire'
  else {
    kind = {
      human: 'special_human',
      food: 'special_food',
      eaten: 'special_eaten',
      sold: 'special_sold'
    }[event.special_reason] || 'special_other'
  }
  const template = stableTemplate(report, 'timeline_detail', kind, event.event_id, texts.DAILY_REPORT_TIMELINE_DETAIL_TEXTS[kind])
  return template
    .replace('{attacker}', () => attacker)
    .replace('{target}', () => target)
    .replace('{victim}', () => victim)
}

const timelineAsset = event => {
  if (event.event_type === 'reserved_special') return TIMELINE_ASSETS.special
  if (isReservation(event)) return TIMELINE_ASSETS.reservation
  if (event.event_type === 'backfire' || event.event_type === 'bot_backfire') return TIMELINE_ASSETS.backfire
  if (event.event_type === 'escape') return TIMELINE_ASSETS.escape
  return TIMELINE_ASSETS.success
}

const timelineCard = report => {
  const selection = report.timeline
  if (!selection) return { intro: '', events: [] }
  const first = selection.anchor || selection.events[0]
  const attacker = reportName(report, first.attacker_id, first.attacker_name)
  const target = reportName(report, first.target_id, first.target_name)
  const identity = [first.event_id, ...selection.events.map(event => event.event_id)].join(':')
  const intro = stableTemplate(report, 'timeline_intro', selection.kind, identity, texts.DAILY_REPORT_TIMELINE_INTRO_TEXTS[selection.kind])
    .replace('{attacker}', () => attacker)
    .replace('{target}', () => target)
    .replace('{event_count}', selection.events.length)
  const ordinals = ['第一次', '第二次', '第三次']
  return {
    intro,
    events: selection.events.slice(0, 3).map((event, index) => ({
      ordinal: ordinals[index],
      icon: assetUrl('report', timelineAsset(event)),
      html: timelineEventDetail(report, event).replace(/\n/g, '<br>')
    }))
  }
}

const avatarFor = (report, entry, kind) => {
  if (entry.imageName) {
    try {
      if (fs.existsSync(entry.imageName)) return fileUrl(entry.imageName)
    } catch {}
  }
  if (entry.pigId) {
    const pig = getPigById(report.officialPigs, entry.pigId)
    if (pig) {
      const level = kind === 'expert_level' ? Math.max(0, entry.score || 0) : 0
      const appearance = resolveAppearance(pig, level)
      if (appearance.imagePath) return fileUrl(appearance.imagePath)
    }
  }
  return assetUrl('report', 'header_pig_news.png')
}

const rankingCards = report => report.rankings.map(ranking => ({
  title: RANKING_TITLES[ranking.kind],
  entries: ranking.entries.map(entry => ({
    rank: entry.rank,
    name: entry.displayName || report.display_names?.[entry.userId] || entry.userId,
    detail: {
      expert_level: `${entry.pigName || pigName(report, entry.pigId)} Lv.${entry.score}`,
      roast_success: `${entry.score} 次`,
      catalog: `${entry.score} 种`
    }[ranking.kind],
    avatar: avatarFor(report, entry, ranking.kind)
  }))
}))

const couponCard = report => {
  if (!report.protections?.length) return null
  const protection = report.protections[0]
  return {
    name: protection.display_name || report.display_names?.[protection.user_id] || protection.user_id,
    benefit: `保护 Lv.${protection.base_level}`,
    roast_count: protection.roast_count || 0
  }
}

export const buildReportView = (report, officialPigs) => {
  const date = report.date_str
  const [year, month, day] = date.split('-')
  const parts = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)))
  const weekday = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'][parts.getUTCDay()]
  const observation = observationCard({ ...report, officialPigs })
  const headline = headlineCard({ ...report, officialPigs })
  const timeline = timelineCard({ ...report, officialPigs })
  return {
    volume: `VOL.${year}-${month}${day}`,
    year,
    monthDay: `${month}.${day}`,
    weekday,
    stats: report.overview_metrics.map(metric => ({
      icon: assetUrl('report', STAT_ASSETS[metric.kind]),
      label: metric.label,
      value: metric.value,
      unit: metric.unit
    })),
    observation,
    headline,
    eventIntro: timeline.intro,
    events: timeline.events,
    rankings: rankingCards({ ...report, officialPigs }),
    coupon: couponCard(report),
    footer: '数据截止 23:45，仅统计本群当日记录'
  }
}

export const reportEscape = esc
