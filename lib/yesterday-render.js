// 昨日回顾卡：720px 宽、动态高度；素材和字体全部使用绝对 file:// URL。
import { pathToFileURL } from 'url'
import { assetUrl, buildFontCss, renderSegment, uniqueSaveId, yesterdayTemplate } from './render.js'
import { dateParts } from './time.js'

const esc = value => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&apos;')

const highlight = value => esc(value)
  .replace(/【([^】]+)】/g, '<span class="name">【$1】</span>')
  .replace(/(\d+)/g, '<span class="num">$1</span>')

const statIcon = kind => {
  if (/escape|逃脱/.test(kind)) return assetUrl('yesterday', 'runner@4x.png')
  return assetUrl('yesterday', 'flame@4x.png')
}

export const buildYesterdayView = recap => {
  const parts = dateParts(recap.date_str) || { month: '', day: '' }
  const makeup = Boolean(recap.snapshot?.is_makeup)
  return {
    title: makeup ? '昨日小猪 · 补签' : '昨日小猪',
    dateLabel: `${Number(parts.month)}月${Number(parts.day)}日`,
    roleLine: `${makeup ? '补签抽到' : '昨天你是'} 【${recap.pig_name}】`,
    roleHtml: `${makeup ? '补签抽到' : '昨天你是'} <span class="name">【${esc(recap.pig_name)}】</span>`,
    outcome: recap.outcome_text || '',
    heroImage: recap.image_path ? pathToFileURL(recap.image_path).href : '',
    footprints: (recap.footprints || []).map(item => ({
      label: item.label,
      count: item.count,
      icon: statIcon(item.label)
    })),
    highlightTitle: recap.scope === 'cross_group' ? '昨日高光 · 跨群' : '昨日高光',
    experiences: (recap.experiences || []).map(item => ({ html: highlight(item.text) })),
    summary: recap.summary ? { title: recap.summary.kind === 'none' ? '昨日小结' : '昨日小结', text: recap.summary.text } : null,
    aftereffect: recap.aftereffect_text || '',
    makeup,
    description: recap.pig_description || '',
    analysis: recap.pig_analysis || '',
    hasInteractions: Boolean((recap.footprints || []).length || (recap.experiences || []).length || recap.summary)
  }
}

export const buildYesterdayRenderData = recap => ({
  ...buildYesterdayView(recap),
  fontCss: buildFontCss(),
  background: assetUrl('yesterday', 'backgrounds', 'pink_dream.jpg'),
  book: assetUrl('yesterday', 'header_book@4x.png'),
  divider: assetUrl('yesterday', 'header_divider@4x.png'),
  highlightDivider: assetUrl('yesterday', 'highlight_divider@4x.png'),
  summaryDivider: assetUrl('yesterday', 'summary_divider@4x.png'),
  tape: assetUrl('yesterday', 'tape@4x.png'),
  heart: assetUrl('yesterday', 'heart@4x.png'),
  shield: assetUrl('yesterday', 'shield@4x.png'),
  sparkle: assetUrl('yesterday', 'sparkle@4x.png'),
  decorBraces: assetUrl('yesterday', 'decor', 'braces_pink.png'),
  decorFlower: assetUrl('yesterday', 'decor', 'flower_pink.png'),
  decorSparkleGold: assetUrl('yesterday', 'decor', 'sparkle_gold_large.png'),
  decorSparklePink: assetUrl('yesterday', 'decor', 'sparkle_pink.png')
})

export const renderYesterdayCard = async recap => {
  const data = buildYesterdayRenderData(recap)
  return renderSegment({
    name: 'rollpig-yesterday',
    tplFile: yesterdayTemplate,
    saveId: uniqueSaveId(`rollpig-yesterday-${recap.snapshot?.pig_id || 'pig'}`),
    data
  })
}
