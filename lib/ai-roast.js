// AI 烤猪文案：复用锅巴里的 VLM 三项配置，只受 aiRoastEnabled 控制。
// 管理面板的「AI 生成文案」仍然直接走 vlm.js，两者互不影响。
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { readConfig } from './app-config.js'
import { formatText } from './texts.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA_DIR = process.env.ROLLPIG_DATA_DIR
  ? path.resolve(process.env.ROLLPIG_DATA_DIR)
  : path.resolve(__dirname, '..', 'data')
const LIBRARY_PATH = path.join(DATA_DIR, 'roast-library.json')
const DEFAULT_TEMPLATES = [
  '你本是一只无忧无虑的【{origin}】，却没能逃过命运的安排，含泪变成了【{food}】。',
  '看看你现在的样子！虽然不再是【{origin}】，但作为【{food}】的你，依然散发着诱人的光泽。'
]
const PVP_TEMPLATES = [
  '【{k}】手法娴熟，手起刀落，将【{v}】（{origin}）做成了美味的【{food}】！',
  '【{v}】还没反应过来，就被【{k}】扔上了烤架。再见了，{origin}；你好，{food}。'
]
const MAX_OUTPUT_CHARS = 240
const AI_TIMEOUT_MS = 20_000
const AI_CONCURRENCY = 4

const log = () => globalThis.logger || console

let library = null
let active = 0
const waiting = []

const acquire = () => new Promise(resolve => {
  if (active < AI_CONCURRENCY) {
    active++
    resolve()
    return
  }
  waiting.push(resolve)
})

const release = () => {
  active--
  const next = waiting.shift()
  if (next) {
    active++
    next()
  }
}

export const isAiRoastEnabled = config => {
  const cfg = config || readConfig()
  return Boolean(cfg.aiRoastEnabled && cfg.vlmApiUrl && cfg.vlmApiKey && cfg.vlmModel)
}

const loadLibrary = () => {
  if (library) return library
  try {
    const raw = fs.existsSync(LIBRARY_PATH) ? JSON.parse(fs.readFileSync(LIBRARY_PATH, 'utf8')) : {}
    library = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  } catch (error) {
    log().warn?.('[AI 烤猪] 本地文案库读取失败，将从空库开始:', error)
    library = {}
  }
  return library
}

const saveLibrary = () => {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true })
    const temporary = LIBRARY_PATH + '.tmp'
    fs.writeFileSync(temporary, JSON.stringify(loadLibrary(), null, 2), 'utf8')
    try {
      fs.renameSync(temporary, LIBRARY_PATH)
    } catch (error) {
      if (!['EPERM', 'EEXIST', 'EACCES'].includes(error?.code)) throw error
      fs.copyFileSync(temporary, LIBRARY_PATH)
      try { fs.unlinkSync(temporary) } catch {}
    }
  } catch (error) {
    log().warn?.('[AI 烤猪] 本地文案库保存失败:', error)
  }
}

const extractOriginFeature = pig => {
  const description = String(pig?.description || '').trim()
  if (description && [...description].length <= 15) return description
  const analysis = String(pig?.analysis || '').trim()
  if (analysis) return [...analysis].slice(0, 20).join('')
  const name = String(pig?.name || '').trim()
  return [...name].slice(0, 20).join('') || '一只普通小猪'
}

const endpointOf = base => String(base || '').replace(/\/+$/, '').replace(/\/chat\/completions$/, '') + '/chat/completions'

const prepareModel = (cfg, baseUrl) => {
  const model = String(cfg.vlmModel || '').trim()
  if (!baseUrl.includes('api.deepseek.com')) return { model, extraBody: null }
  if (model === 'deepseek-chat') return { model: 'deepseek-v4-flash', extraBody: { thinking: { type: 'disabled' } } }
  if (model === 'deepseek-reasoner') return { model: 'deepseek-v4-flash', extraBody: { thinking: { type: 'enabled' } } }
  if (model === 'deepseek-v4-flash') return { model, extraBody: { thinking: { type: 'disabled' } } }
  return { model, extraBody: null }
}

const sanitizeOutput = raw => String(raw || '')
  .trim()
  .replace(/^["'“”]+|["'“”]+$/g, '')
  .replace(/\s*\n+\s*/g, ' ')
  .slice(0, MAX_OUTPUT_CHARS)

const callAi = async ({ originPig, foodPig, isPvp }) => {
  const cfg = readConfig()
  if (!isAiRoastEnabled(cfg)) return ''
  const originFeature = extractOriginFeature(originPig)
  const originName = String(originPig?.name || '小猪')
  const foodName = String(foodPig?.name || '熟食')
  const system = '你是一个擅长黑色幽默、说话刻薄但好笑的脱口秀演员。你的任务是进行‘猪生终结’吐槽。'
  const prompt = isPvp
    ? [
        `【吐槽对象】：凶手把受害者（本体【${originName}】，特征：${originFeature}）残忍地做成了【${foodName}】。`,
        '请写一段40字以内的解说，**必须使用占位符**：{k}代表凶手，{v}代表受害者。',
        '',
        '严格遵守【对比公式】：',
        '“{k} (动作)... 把 {v} (惨状/前世特征)... 变成了 (今生美食)...”',
        '',
        '参考范例：',
        '- “{k} 没给 {v} 任何辩解的机会。前一秒它还是只特立独行的野猪，下一秒就成了 {k} 盘子里滋滋作响的五花肉。”',
        '- “{k} 的手艺真是‘惊天地泣鬼神’，硬生生把 {v} 这只大懒猪，炼成了一锅香喷喷的猪油。”',
        '要求：既要体现受害者惨状，又要调侃凶手，必须包含 {k} 和 {v}。'
      ].join('\n')
    : [
        '现在进行一场【猪生终结吐槽大会】。',
        `对象前世：【${originName}】（特征：${originFeature}）`,
        `对象今生：【${foodName}】`,
        '',
        '请写一段40字以内的神吐槽。必须严格遵守以下【对比公式】：',
        '“曾经你(前世特征/地位)...如今你(死后状态/口感)...”',
        '',
        '参考范例（学习这种语气）：',
        '- “曾经你是丛林里的一方霸主野猪，如今却成为培根在我的平底锅里滋滋作响。别说，比起你的獠牙，还是你的油脂更迷人。”',
        '- “生前你是个除了吃就是睡的大懒猪，没想到变成红烧肉后，这层肥膘反而成了精华，真是懒猪有懒猪福。”',
        '',
        '要求：',
        '1. 必须同时提到“生前”和“死后”的反差。',
        '2. 风格要毒舌、幽默、带点地狱笑话，不要纯夸好吃。',
        '3. 严禁出现“这道菜”、“这道美食”这种客套话，直接对话（用“你”）。'
      ].join('\n')

  const { model, extraBody } = prepareModel(cfg, cfg.vlmApiUrl)
  await acquire()
  try {
    const body = {
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: prompt }
      ],
      stream: false,
      max_tokens: 4096,
      temperature: 0.8
    }
    if (extraBody) body.extra_body = extraBody
    const response = await fetch(endpointOf(cfg.vlmApiUrl), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.vlmApiKey}`
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(AI_TIMEOUT_MS)
    })
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new Error(`AI 烤猪接口 HTTP ${response.status}: ${text.slice(0, 160)}`)
    }
    const data = await response.json().catch(() => null)
    const content = data?.choices?.[0]?.message?.content
    if (typeof content !== 'string' || !content.trim()) throw new Error('AI 烤猪返回内容为空')
    return sanitizeOutput(content)
  } catch (error) {
    log().warn?.('[AI 烤猪] 生成失败，回退本地文案:', error)
    return ''
  } finally {
    release()
  }
}

const formatRoast = (text, originPig, foodPig, operatorName, targetName) => formatText(text, {
  origin: String(originPig?.name || '小猪'),
  food: String(foodPig?.name || '熟食'),
  k: operatorName || '神秘人',
  v: targetName || '倒霉蛋'
})

const saveGenerated = (originId, foodKey, text) => {
  const origin = String(originId || '')
  const key = String(foodKey || '')
  if (!origin || !key || !text) return
  const db = loadLibrary()
  db[origin] ||= {}
  db[origin][key] ||= []
  const existing = db[origin][key]
  const normalized = text.replace(/\s+/g, '')
  if (existing.some(item => String(item).replace(/\s+/g, '') === normalized)) return
  existing.push(text)
  saveLibrary()
}

/**
 * 取一段烤猪文案。优先本地库；AI 开启时在库为空或不足 5 条时按 40% 概率补生成。
 * 返回的文本已经替换好 {origin}/{food}/{k}/{v}。
 */
export const getRoastText = async ({ originPig, foodPig, operatorName = '', targetName = '' }) => {
  const originId = String(originPig?.id || '')
  const isPvp = Boolean(operatorName)
  const foodKey = String(foodPig?.id || '') + (isPvp ? '_pvp' : '')
  const db = loadLibrary()
  const pool = db?.[originId]?.[foodKey] || []
  const cfg = readConfig()

  if (isAiRoastEnabled(cfg) && (pool.length === 0 || (pool.length < 5 && Math.random() < 0.4))) {
    const generated = await callAi({ originPig, foodPig, isPvp })
    if (generated) {
      saveGenerated(originId, foodKey, generated)
      return formatRoast(generated, originPig, foodPig, operatorName, targetName)
    }
  }

  if (pool.length) {
    const selected = pool[Math.floor(Math.random() * pool.length)]
    return formatRoast(selected, originPig, foodPig, operatorName, targetName)
  }

  const fallback = isPvp ? PVP_TEMPLATES : DEFAULT_TEMPLATES
  return formatRoast(fallback[Math.floor(Math.random() * fallback.length)], originPig, foodPig, operatorName, targetName)
}

export const roastLibraryPath = () => LIBRARY_PATH
