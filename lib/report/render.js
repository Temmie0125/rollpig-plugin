// 日报 HTML 渲染：1024px 逻辑宽度，动态高度；所有素材/字体使用绝对 file:// URL。
import {
  assetUrl,
  buildFontCss,
  renderSegment,
  reportTemplate,
  uniqueSaveId
} from '../render.js'
import { buildReportView } from './view.js'

export const buildReportRenderData = ({ report, officialPigs, cutoffTime = '23:45' }) => {
  const view = buildReportView(report, officialPigs)
  const hasLeft = Boolean(view.observation || view.headline)
  const hasEvents = Boolean(view.eventIntro || view.events.length)
  return {
    ...view,
    hasLeft,
    hasEvents,
    fontCss: buildFontCss(),
    paperUrl: assetUrl('report', 'clean-paper-original-tone.jpg'),
    inkBlack: assetUrl('report', 'ink-texture-black.png'),
    inkRed: assetUrl('report', 'ink-texture-red.png'),
    readPig: assetUrl('report', 'header_pig_news.png'),
    couponSurface: assetUrl('report', 'coupon_surface.jpg'),
    couponShield: assetUrl('report', 'coupon_shield.png'),
    couponBarcode: assetUrl('report', 'coupon_barcode.png'),
    footer: `数据截止 ${cutoffTime}，仅统计本群当日记录`
  }
}

export const renderReportCard = async ({ report, officialPigs, cutoffTime = '23:45' }) => {
  const data = buildReportRenderData({ report, officialPigs, cutoffTime })
  return renderSegment({
    name: 'rollpig-report',
    tplFile: reportTemplate,
    saveId: uniqueSaveId(`rollpig-report-${report.group_id}-${report.date_str}`),
    data
  })
}
