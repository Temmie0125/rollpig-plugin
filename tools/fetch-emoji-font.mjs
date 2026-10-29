// 下载 Google Fonts 的 Noto Color Emoji 分片字体，供日报/昨日卡在 Linux 无 emoji 字体时使用。
// 生成 resource/fonts/emoji.css（相对 URL），渲染时再替换为 file:// 绝对地址内联。
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PLUGIN_ROOT = path.resolve(__dirname, '..')
const FONT_DIR = path.join(PLUGIN_ROOT, 'resource', 'fonts')
const EMOJI_DIR = path.join(FONT_DIR, 'emoji')
const CSS_PATH = path.join(FONT_DIR, 'emoji.css')
const CSS_URL = 'https://fonts.googleapis.com/css2?family=Noto+Color+Emoji&display=block'
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36'

const main = async () => {
  fs.mkdirSync(EMOJI_DIR, { recursive: true })
  const response = await fetch(CSS_URL, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30_000) })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  let css = await response.text()
  const urls = [...css.matchAll(/url\((https:[^)]+)\)/g)].map(match => match[1])
  if (!urls.length) throw new Error('CSS 中没有字体 URL')

  let index = 0
  let bytes = 0
  for (const url of urls) {
    const filename = `${index++}.woff2`
    const target = path.join(EMOJI_DIR, filename)
    const font = await fetch(url, { signal: AbortSignal.timeout(60_000) })
    if (!font.ok) throw new Error(`字体分片下载失败 HTTP ${font.status}: ${url}`)
    const buffer = Buffer.from(await font.arrayBuffer())
    if (buffer.length < 1000) throw new Error(`字体分片异常小: ${url}`)
    fs.writeFileSync(target, buffer)
    bytes += buffer.length
    css = css.replaceAll(url, `emoji/${filename}`)
  }
  fs.writeFileSync(CSS_PATH, css, 'utf8')
  console.log('[fetch-emoji-font] 分片:', urls.length)
  console.log('[fetch-emoji-font] 总字节:', bytes)
  console.log('[fetch-emoji-font] CSS:', CSS_PATH)
}

main().catch(error => {
  console.error('[fetch-emoji-font] 失败:', error)
  process.exit(1)
})
