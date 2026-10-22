// 自定义图鉴存储层：读取 resource/custom/ 下用户放入的扩展包（任意 *.json，丢入即读）
// 与面板写入的 custom-pigs.json，按 id 与官方 resource/pig.json 合并——
// id 冲突时自定义仅覆盖显示（名称/文案/图片），收集进度按 id 记录在 data/records.json，与显示层天然解耦；
// id 不冲突的自定义猪猪追加进图鉴与抽取池。
//
// 注意：本文件所有导出一律用箭头函数——loader 会把插件目录下的 .js 交给 importPlugin，
// 带 .prototype 的导出会被 loadPlugin 误当插件类实例化成僵尸插件项
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const PLUGIN_ROOT = path.resolve(__dirname, '..')
export const OFFICIAL_JSON_PATH = path.join(PLUGIN_ROOT, 'resource', 'pig.json')
export const OFFICIAL_IMG_DIR = path.join(PLUGIN_ROOT, 'resource', 'image')
export const CUSTOM_DIR = path.join(PLUGIN_ROOT, 'resource', 'custom')
export const CUSTOM_IMG_DIR = path.join(CUSTOM_DIR, 'image')
/** 面板写入的条目文件；合并时置于扩展包之后加载，同 id 时面板数据优先 */
export const PANEL_JSON_NAME = 'custom-pigs.json'
export const PANEL_JSON_PATH = path.join(CUSTOM_DIR, PANEL_JSON_NAME)

// id 同时是图片文件名，白名单字符防路径穿越
export const PIG_ID_RE = /^[A-Za-z0-9_-]{1,64}$/
export const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.gif', '.webp']

const log = globalThis.logger || console
const md5Buf = (buf) => crypto.createHash('md5').update(buf).digest('hex')

// 按魔数探测图片真实格式（QQ 媒体常无后缀或统一 .jpg）
const sniffImageExt = (head) => {
  if (!head || head.length < 12) return ''
  if (head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47) return '.png'
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return '.jpg'
  if (head.subarray(0, 3).toString('ascii') === 'GIF') return '.gif'
  if (head.subarray(0, 4).toString('ascii') === 'RIFF' && head.subarray(8, 12).toString('ascii') === 'WEBP') return '.webp'
  return ''
}

// ---------- 条目读取与合并 ----------

const listCustomJsonFiles = () => {
  try {
    if (!fs.existsSync(CUSTOM_DIR)) return []
    return fs.readdirSync(CUSTOM_DIR).filter(f => f.toLowerCase().endsWith('.json')).sort()
  } catch {
    return []
  }
}

// 目录下全部 json 的「文件名:mtimeMs:size」指纹；面板走临时文件 + rename 原子写，
// 会刷新目录内容，用户手改文件也能被检测到
const fingerprint = (files) => files.map(f => {
  try {
    const st = fs.statSync(path.join(CUSTOM_DIR, f))
    return `${f}:${st.mtimeMs}:${st.size}`
  } catch {
    return `${f}:missing`
  }
}).join('|')

const sanitizeEntry = (raw, file) => {
  if (!raw || typeof raw !== 'object') return null
  const id = String(raw.id || '').trim()
  if (!PIG_ID_RE.test(id)) return null
  return {
    id,
    name: String(raw.name || '').trim() || id,
    description: String(raw.description || ''),
    analysis: String(raw.analysis || ''),
    md5: typeof raw.md5 === 'string' ? raw.md5.toLowerCase() : '',
    addedBy: String(raw.addedBy || ''),
    addedAt: Number(raw.addedAt) || 0,
    file,
  }
}

const loadCustomUncached = (files) => {
  // 面板文件最后合并，同 id 时面板数据覆盖扩展包
  const ordered = [...files.filter(f => f !== PANEL_JSON_NAME), ...files.filter(f => f === PANEL_JSON_NAME)]
  const byId = new Map()
  for (const f of ordered) {
    let arr
    try {
      arr = JSON.parse(fs.readFileSync(path.join(CUSTOM_DIR, f), 'utf-8'))
    } catch (err) {
      log.error?.(`[自定义图鉴] 解析 ${f} 失败: ${err?.message || err}`)
      continue
    }
    if (!Array.isArray(arr)) continue
    for (const raw of arr) {
      const entry = sanitizeEntry(raw, f)
      if (!entry) continue
      if (byId.has(entry.id)) log.warn?.(`[自定义图鉴] id「${entry.id}」重复定义（${f}），后者覆盖前者`)
      byId.set(entry.id, entry)
    }
  }
  return [...byId.values()]
}

// 缓存挂 globalThis：TRSS loader 每条消息都会重新实例化插件类，实例级缓存不共享
const CACHE_KEY = '__rollpig_custom_cache'

const loadCustomCached = () => {
  const files = listCustomJsonFiles()
  const fp = fingerprint(files)
  const cache = globalThis[CACHE_KEY]
  if (cache && cache.fp === fp) return cache.data
  const data = loadCustomUncached(files)
  globalThis[CACHE_KEY] = { fp, data }
  if (data.length) {
    log.info?.(`[自定义图鉴] 已加载 ${data.length} 条自定义猪猪（来源: ${[...new Set(data.map(c => c.file))].join(', ')}）`)
  }
  return data
}

const probeImage = (dir, pigId) => {
  for (const ext of IMAGE_EXTS) {
    const p = path.join(dir, pigId + ext)
    if (fs.existsSync(p)) return p
  }
  return null
}

/** 自定义图片路径（仅查 custom/image/），不存在返回 null */
export const findCustomImage = (pigId) => probeImage(CUSTOM_IMG_DIR, pigId)

/** 猪猪图片路径：自定义优先，官方兜底（沿用 png→jpg→jpeg→gif→webp 探测），不存在返回 null */
export const findPigImageAny = (pigId) => findCustomImage(pigId) || probeImage(OFFICIAL_IMG_DIR, pigId)

/** 官方图鉴条目（读 resource/pig.json，异常时返回空数组） */
export const listOfficialPigs = () => {
  try {
    const arr = JSON.parse(fs.readFileSync(OFFICIAL_JSON_PATH, 'utf-8'))
    return Array.isArray(arr) ? arr : []
  } catch {
    return []
  }
}

/** 当前自定义条目（含来源文件 file 字段） */
export const listCustomPigs = () => loadCustomCached()

/**
 * 官方 + 自定义合并：
 * - 官方条目在前、保持原顺序（source: 'official'）
 * - id 冲突的自定义条目原位覆盖显示字段（source: 'override'）
 * - 新增自定义条目按加载顺序追加尾部（source: 'custom'）
 */
export const getMergedPigs = (officialPigs) => {
  const byId = new Map((officialPigs || []).map(p => [String(p.id), { ...p, source: 'official' }]))
  for (const c of loadCustomCached()) {
    const prev = byId.get(c.id)
    byId.set(c.id, {
      id: c.id,
      name: c.name,
      description: c.description,
      analysis: c.analysis,
      file: c.file,
      source: prev ? 'override' : 'custom',
    })
  }
  return [...byId.values()]
}

// ---------- 查重 ----------

// 图片内容 MD5 索引：byMd5(md5 -> 首个占用 id)。官方部分按目录指纹懒构建（百余张小图一次几十毫秒），
// 自定义部分随条目缓存失效；指纹同时纳入自定义图片目录，手动丢图也能触发重建
const MD5_KEY = '__rollpig_md5_cache'

const buildMd5Index = () => {
  const byMd5 = new Map()
  const add = (id, md5v) => {
    if (!md5v || byMd5.has(md5v)) return
    byMd5.set(md5v, id)
  }
  for (const c of loadCustomCached()) {
    let md5v = c.md5
    if (!md5v) {
      const img = findCustomImage(c.id)
      if (img) {
        try { md5v = md5Buf(fs.readFileSync(img)) } catch {}
      }
    }
    add(c.id, md5v)
  }
  try {
    for (const f of fs.readdirSync(OFFICIAL_IMG_DIR)) {
      add(f.replace(/\.[^.]+$/, ''), md5Buf(fs.readFileSync(path.join(OFFICIAL_IMG_DIR, f))))
    }
  } catch {}
  return { byMd5 }
}

const dirFp = (dir) => {
  try {
    const st = fs.statSync(dir)
    return `${st.mtimeMs}:${st.size}`
  } catch {
    return 'missing'
  }
}

const md5IndexCached = () => {
  const fp = `${fingerprint(listCustomJsonFiles())}|${dirFp(CUSTOM_IMG_DIR)}|${dirFp(OFFICIAL_IMG_DIR)}`
  const cache = globalThis[MD5_KEY]
  if (cache && cache.fp === fp) return cache.data
  const data = buildMd5Index()
  globalThis[MD5_KEY] = { fp, data }
  return data
}

/**
 * 冲突检测：id / 名称 / 图片MD5 任一与官方或已有自定义条目重复时返回提示明细。
 * 只提示不阻断——冲突允许用自定义覆盖显示，是否提交由前端确认
 */
export const checkConflicts = ({ id, name = '', md5 = '', excludeId = '' } = {}) => {
  const conflicts = []
  const official = listOfficialPigs()
  const custom = loadCustomCached()
  const normName = String(name || '').trim().toLowerCase()

  const officialSameId = official.find(p => String(p.id) === id)
  const customSameId = custom.find(p => p.id === id && p.id !== excludeId)
  if (officialSameId) {
    conflicts.push({ type: 'id', scope: 'official', id, name: officialSameId.name || id, detail: `与官方猪猪「${officialSameId.name}」（${id}）id 相同，提交后将覆盖官方显示` })
  } else if (customSameId) {
    conflicts.push({ type: 'id', scope: 'custom', id, name: customSameId.name, detail: `与自定义猪猪「${customSameId.name}」（${id}，${customSameId.file}）id 相同，提交后将覆盖该自定义条目` })
  }

  if (normName) {
    const o = official.find(p => String(p.name || '').trim().toLowerCase() === normName && String(p.id) !== id)
    if (o) conflicts.push({ type: 'name', scope: 'official', id: String(o.id), name: o.name, detail: `与官方猪猪「${o.name}」（${o.id}）重名` })
    const c = custom.find(p => p.name.toLowerCase() === normName && p.id !== id && p.id !== excludeId)
    if (c) conflicts.push({ type: 'name', scope: 'custom', id: c.id, name: c.name, detail: `与自定义猪猪「${c.name}」（${c.id}，${c.file}）重名` })
  }

  if (md5) {
    const holder = md5IndexCached().byMd5.get(md5.toLowerCase())
    if (holder && holder !== id && holder !== excludeId) {
      const holderName = official.find(p => String(p.id) === holder)?.name || custom.find(p => p.id === holder)?.name || holder
      const scope = official.some(p => String(p.id) === holder) ? 'official' : 'custom'
      conflicts.push({ type: 'md5', scope, id: holder, name: holderName, detail: `图片与「${holderName}」（${holder}）完全相同` })
    }
  }
  return conflicts
}

// ---------- 写入（面板通道；扩展包 json 由用户自行维护，面板不回写） ----------

const readPanelArr = () => {
  try {
    const arr = JSON.parse(fs.readFileSync(PANEL_JSON_PATH, 'utf-8'))
    return Array.isArray(arr) ? arr : []
  } catch {
    return []
  }
}

const writePanelArr = (arr) => {
  fs.mkdirSync(CUSTOM_DIR, { recursive: true })
  // 临时文件 + rename 原子替换；rename 会刷新目录内容，触发合并缓存重载
  const tmp = PANEL_JSON_PATH + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(arr, null, 2))
  fs.renameSync(tmp, PANEL_JSON_PATH)
}

/** 清掉某 id 在 custom/image/ 下的全部扩展名变体 */
export const removeImageFiles = (pigId) => {
  for (const ext of IMAGE_EXTS) {
    try { fs.unlinkSync(path.join(CUSTOM_IMG_DIR, pigId + ext)) } catch {}
  }
}

/**
 * 保存面板条目（upsert custom-pigs.json）：
 * - 带 image（Buffer）时替换图片：魔数嗅探真实扩展名、清理旧扩展名文件、重算 MD5
 * - 不带 image 时仅更新文案，保留原 md5/addedBy/addedAt
 * 对官方 id 或扩展包 id 调用即等于用面板数据覆盖其显示
 */
export const savePanelPig = ({ id, name = '', description = '', analysis = '', addedBy = '', image = null, md5: knownMd5 = '' }) => {
  if (!PIG_ID_RE.test(id)) throw new Error(`id 不合法（仅允许字母/数字/-/_，最长 64 字符）：${id}`)
  const arr = readPanelArr()
  const prev = arr.find(p => p?.id === id)
  const record = {
    id,
    name: String(name || '').trim() || id,
    description: String(description || ''),
    analysis: String(analysis || ''),
    md5: knownMd5 || prev?.md5 || '',
    addedBy: prev?.addedBy || addedBy,
    addedAt: prev?.addedAt || Date.now(),
  }
  if (image) {
    const ext = sniffImageExt(image.subarray(0, 12))
    if (!ext) throw new Error('无法识别的图片格式（仅支持 png/jpg/gif/webp）')
    record.md5 = md5Buf(image)
    fs.mkdirSync(CUSTOM_IMG_DIR, { recursive: true })
    removeImageFiles(id)
    fs.writeFileSync(path.join(CUSTOM_IMG_DIR, id + ext), image)
  }
  if (prev) Object.assign(prev, record)
  else arr.push(record)
  writePanelArr(arr)
  return record
}

/**
 * 删除面板条目（仅 custom-pigs.json 管理的条目）：
 * 覆盖型条目删除后官方显示自动恢复。返回 { removed, managed }，managed:false 表示该 id 来自扩展包
 */
export const deletePanelPig = (id) => {
  const arr = readPanelArr()
  const idx = arr.findIndex(p => p?.id === id)
  if (idx < 0) return { removed: false, managed: false }
  arr.splice(idx, 1)
  writePanelArr(arr)
  removeImageFiles(id)
  return { removed: true, managed: true }
}
