// 渲染统一入口：所有模板都走宿主 puppeteer 兼容层，图片/字体一律用 file:// 绝对 URL。
// Linux 服务器可能没有中文字体或 Emoji 字体，因此 report/yesterday 模板内联内置字体。
import fs from 'fs'
import path from 'path'
import { fileURLToPath, pathToFileURL } from 'url'
import { segment } from 'oicq'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
let rendererPromise = null
const getRenderer = async () => {
  rendererPromise ||= import('../../../lib/puppeteer/puppeteer.js')
    .then(module => module.default)
    .catch(error => {
      rendererPromise = null
      throw error
    })
  return rendererPromise
}
export const PLUGIN_ROOT = path.resolve(__dirname, '..')
const FONT_DIR = path.join(PLUGIN_ROOT, 'resource', 'fonts')

export const fileUrl = file => pathToFileURL(file).href
export const assetUrl = (...parts) => fileUrl(path.join(PLUGIN_ROOT, 'resource', ...parts))

const fontFace = (family, file, weight = '100 900') => {
  const full = path.join(FONT_DIR, file)
  if (!fs.existsSync(full)) return ''
  const format = file.endsWith('.otf') ? 'opentype' : 'truetype'
  return `@font-face{font-family:'${family}';src:url("${fileUrl(full)}") format('${format}');font-weight:${weight};font-style:normal;font-display:block;}`
}

let fontCssCache = null

/** 把主字体和 Google Emoji 分片合并成一段可内联的 CSS */
export const buildFontCss = () => {
  if (fontCssCache) return fontCssCache
  const parts = [
    fontFace('RollPigSans', 'SourceHanSansSC-Medium.otf'),
    fontFace('RollPigSerifBlack', 'RollPigDailySerif-Black.subset.otf'),
    fontFace('RollPigSerifBold', 'RollPigDailySerif-Bold.subset.otf'),
    fontFace('RollPigSerifRegular', 'RollPigDailySerif-Regular.subset.otf'),
    fontFace('RollPigTitle', 'ZCOOLKuaiLe-Regular.ttf')
  ].filter(Boolean)

  try {
    const emojiCssPath = path.join(FONT_DIR, 'emoji.css')
    if (fs.existsSync(emojiCssPath)) {
      const emojiDir = fileUrl(path.join(FONT_DIR, 'emoji')).replace(/\/?$/, '/')
      const emojiCss = fs.readFileSync(emojiCssPath, 'utf8').replace(
        /url\(emoji\/([^)]+)\)/g,
        (_, file) => `url("${emojiDir}${file}")`
      )
      parts.push(emojiCss)
    }
  } catch (error) {
    ;(globalThis.logger || console).warn?.('[今天是什么小猪] Emoji 字体 CSS 加载失败:', error)
  }

  fontCssCache = parts.join('\n')
  return fontCssCache
}

export const uniqueSaveId = prefix => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

/** 调用宿主渲染器；返回 segment.image，供 e.reply / group.sendMsg 直接使用 */
export const renderSegment = async ({ name, tplFile, saveId, data = {}, imgType = 'png' }) => {
  const puppeteer = await getRenderer()
  const image = await puppeteer.screenshot(name, {
    tplFile,
    saveId: saveId || uniqueSaveId(name),
    imgType,
    ...data
  })
  if (!image) throw new Error('渲染器返回空图片')
  if (typeof image === 'object' && image.type === 'image') return image
  return segment.image(image)
}

export const reportTemplate = path.join(PLUGIN_ROOT, 'resource', 'report.html')
export const yesterdayTemplate = path.join(PLUGIN_ROOT, 'resource', 'yesterday.html')
export const penTemplate = path.join(PLUGIN_ROOT, 'resource', 'pen.html')
