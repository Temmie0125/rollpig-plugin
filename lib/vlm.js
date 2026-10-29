// VLM 文案生成：OpenAI 兼容 chat/completions（图片走 base64 data URI），原生 fetch，零新依赖
// 配置读 config/config.yaml 的 vlmApiUrl / vlmApiKey / vlmModel 三个顶层字段（锅巴配置页维护）
//
// 注意：本文件所有导出一律用箭头函数——loader 会把插件目录下的 .js 交给 importPlugin，
// 带 .prototype 的导出会被 loadPlugin 误当插件类实例化成僵尸插件项
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { isVlmConfigured as configHasVlm, readConfig } from './app-config.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const MIME_BY_EXT = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
}

/** VLM 三项配置是否已填齐（供面板决定是否提示先去配置） */
export const isVlmConfigured = () => configHasVlm(readConfig())

// 从官方图鉴随机抽 2 条做 few-shot，让生成文案贴近官方语气
const sampleOfficialExamples = () => {
  try {
    const arr = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'resource', 'pig.json'), 'utf-8'))
    const good = (Array.isArray(arr) ? arr : []).filter(p => p?.name && p?.description && p?.analysis)
    const picked = []
    while (picked.length < Math.min(2, good.length)) {
      const pig = good[Math.floor(Math.random() * good.length)]
      if (!picked.includes(pig)) picked.push(pig)
    }
    return picked.map(p => `名称：${p.name}\n简述：${p.description}\n分析：${p.analysis}`).join('\n------\n')
  } catch {
    return '名称：猪葛亮\n简述：猪里最聪明的一个\n分析：你聪明绝顶，机智过人，有着非凡的智慧和谋略。'
  }
}

// 剥掉 ```json 围栏 / 前后杂文本，取第一段完整 JSON 对象解析
const parseCopyJson = (content) => {
  let text = String(content || '').trim()
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence) text = fence[1].trim()
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('VLM 返回内容中未找到 JSON')
  let parsed
  try {
    parsed = JSON.parse(text.slice(start, end + 1))
  } catch (err) {
    throw new Error(`VLM 返回的 JSON 解析失败：${err.message}`)
  }
  const description = String(parsed.description || '').trim()
  const analysis = String(parsed.analysis || '').trim()
  if (!description || !analysis) throw new Error('VLM 返回的 JSON 缺少 description 或 analysis 字段')
  return { description, analysis }
}

/**
 * 生成猪猪图鉴文案
 * @param {object} opts
 * @param {string} opts.name 猪猪名称（必填，作为主要依据）
 * @param {string} opts.note 可选备注：用户补充的设定/梗/语气要求
 * @param {Buffer} opts.imageBuffer 图片内容（必填）
 * @param {string} opts.imageExt 图片扩展名（带点，默认 .png）
 * @param {object} [opts.config] 覆盖配置（缺省读 config.yaml）
 * @returns {Promise<{description: string, analysis: string}>}
 */
export const generatePigCopy = async ({ name, note = '', imageBuffer, imageExt = '.png', config } = {}) => {
  const cfg = config || readConfig()
  if (!cfg.vlmApiUrl || !cfg.vlmApiKey || !cfg.vlmModel) {
    throw new Error('VLM 未配置：请先在锅巴「今天是什么小猪」配置页填写 API 地址、API Key 与视觉模型')
  }
  if (!Buffer.isBuffer(imageBuffer) || !imageBuffer.length) {
    throw new Error('缺少图片，无法生成文案')
  }

  const mime = MIME_BY_EXT[imageExt.toLowerCase()] || 'image/png'
  const dataUrl = `data:${mime};base64,${imageBuffer.toString('base64')}`
  // 兼容用户填到不同层级：去掉尾部斜杠与已带的 /chat/completions 再统一拼接
  const endpoint = cfg.vlmApiUrl.replace(/\/+$/, '').replace(/\/chat\/completions$/, '') + '/chat/completions'

  const system = [
    '你是 Yunzai 插件「今天是什么小猪」图鉴库的文案作者。',
    '用户会给出一只猪猪的图片、名称和可选备注，请仿照官方文案风格为它撰写图鉴文案。',
    '',
    '官方文案风格示例：',
    sampleOfficialExamples(),
    '',
    '要求：',
    '1. description：一句话简述（30 字以内），点出这只猪最鲜明的特点，轻松幽默。',
    '2. analysis：以第二人称「你」开头的人格分析，2~4 句，贴合图片气质与名称梗，语气俏皮。',
    '3. 若提供了备注，备注中的设定优先于你的联想。',
    '4. 只输出一个 JSON 对象，格式：{"description":"...","analysis":"..."}，不要输出任何其他内容。',
  ].join('\n')

  const userText = `猪猪名称：${name}${note ? `\n补充备注：${note}` : ''}\n请看图输出 JSON 文案。`

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cfg.vlmApiKey}`,
    },
    body: JSON.stringify({
      model: cfg.vlmModel,
      temperature: 0.8,
      messages: [
        { role: 'system', content: system },
        {
          role: 'user',
          content: [
            { type: 'text', text: userText },
            { type: 'image_url', image_url: { url: dataUrl, detail: 'auto' } },
          ],
        },
      ],
    }),
    signal: AbortSignal.timeout(60_000),
  })
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`VLM 接口返回 HTTP ${response.status}：${text.slice(0, 200) || '(无响应体)'}`)
  }
  const data = await response.json().catch(() => null)
  const content = data?.choices?.[0]?.message?.content
  if (!content) throw new Error('VLM 返回内容为空')
  return parseCopyJson(content)
}
