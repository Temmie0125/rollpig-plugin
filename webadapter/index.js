// 猪猪图鉴管理面板：同一份 init 被 QQBot-Web-Adapter 与 Guoba-Plugin 两个宿主扫描调用
// - QWA 通道：页面 iframe 注入 __webBase，API 挂 /qqbot-web/api/rollpig/*，Session(Cookie) 鉴权
// - 锅巴通道：iframe 注入 __apiBase（/api/custom/rollpig-plugin）+ token，API 同前缀挂载，guoba-access-token 头鉴权
// 两个宿主的 registerApi 均自动套登录鉴权，handler 为标准 express (req, res)，无需自行校验身份
//
// 注意：本文件所有导出一律用箭头函数——loader 会把插件目录下运行期新增的 .js 交给 importPlugin，
// 带 .prototype 的导出会被 loadPlugin 误当插件类实例化成僵尸插件项（参见 ../lib/custom-store.js 头注释）
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import {
  CUSTOM_DIR,
  PIG_ID_RE,
  PANEL_JSON_NAME,
  listOfficialPigs,
  listCustomPigs,
  getMergedPigs,
  findPigImageAny,
  checkConflicts,
  savePanelPig,
  deletePanelPig,
} from '../lib/custom-store.js'
import { generatePigCopy, isVlmConfigured } from '../lib/vlm.js'
import { readConfig } from '../lib/app-config.js'

const UPLOAD_CHUNK = 64 * 1024        // 前端分片大小；base64 后约 87KB，低于全局 100kb body 限制
const UPLOAD_MAX_SIZE = 20 * 1024 * 1024
const UPLOAD_TTL = 60 * 60 * 1000
// uploadId -> { path, size, ts }；同一插件的 QWA/锅巴请求不会跨宿主混用，前端始终走同一 API_ROOT
const uploads = new Map()

const pruneUploads = () => {
  const now = Date.now()
  for (const [id, u] of uploads) {
    if (now - u.ts > UPLOAD_TTL || u.size > UPLOAD_MAX_SIZE) {
      try { fs.unlinkSync(u.path) } catch {}
      uploads.delete(id)
    }
  }
}

const discardUpload = (id) => {
  const u = uploads.get(id)
  if (!u) return null
  let buf = null
  try { buf = fs.readFileSync(u.path) } catch {}
  try { fs.unlinkSync(u.path) } catch {}
  uploads.delete(id)
  return buf
}

// 业务失败统一 200 + ok:false（QWA 会把 500 响应脱敏改写，真实原因传不到前端）
const ok = (res, data = {}) => res.json({ ok: true, ...data })
const fail = (res, error) => res.json({ ok: false, error })

const readUpload = (req) => {
  const id = String(req.body?.id || '')
  return { id, u: uploads.get(id) }
}

// 条目视图：合并来源 + 是否面板可管理 + 冲突提示（自定义条目与其余条目的重名/同图）
const pigView = (p, reloadKey) => ({
  id: p.id,
  name: p.name,
  description: p.description || '',
  analysis: p.analysis || '',
  source: p.source || 'official',
  file: p.file || '',
  managed: p.file === PANEL_JSON_NAME,
  hasImage: Boolean(findPigImageAny(p.id)),
  imageVersion: reloadKey,
  conflicts: p.source === 'official'
    ? []
    : checkConflicts({ id: p.id, name: p.name, md5: listCustomPigs().find(c => c.id === p.id)?.md5 || '', excludeId: p.id }),
})

const init = (ctx) => {
  if (!ctx || typeof ctx.registerPage !== 'function' || typeof ctx.registerApi !== 'function') return
  ctx.registerPage({
    id: 'rollpig-manage',
    title: '猪猪图鉴管理',
    icon: '🐷',
    priority: 61,
    src: 'panel.html',
  })

  const api = (method, route, handler) => ctx.registerApi(method, `/rollpig${route}`, handler)

  // ---- 查 ----

  // 图鉴全量列表：官方 + 自定义合并（含来源/冲突标记/统计），面板打开与每次保存后刷新
  api('get', '/pigs', (req, res) => {
    try {
      const reloadKey = String(Date.now())
      const items = getMergedPigs(listOfficialPigs()).map(p => pigView(p, reloadKey))
      ok(res, {
        items,
        stats: {
          total: items.length,
          official: items.filter(p => p.source === 'official').length,
          custom: items.filter(p => p.source === 'custom').length,
          override: items.filter(p => p.source === 'override').length,
        },
        vlmConfigured: isVlmConfigured(),
        aiRoastEnabled: Boolean(readConfig().aiRoastEnabled),
      })
    } catch (err) {
      logger.error(`[猪猪图鉴] 列表获取失败: ${err}`)
      fail(res, `列表获取失败：${err.message || err}`)
    }
  })

  // 图片预览：自定义优先、官方兜底；条目可被覆盖/删除，靠 no-cache + etag 协商避免旧图残留
  api('get', '/image', (req, res) => {
    const id = String(req.query.id || '')
    if (!PIG_ID_RE.test(id)) return fail(res, 'id 不合法', 200)
    const imagePath = findPigImageAny(id)
    if (!imagePath) return fail(res, '图片不存在')
    res.sendFile(path.resolve(imagePath), { headers: { 'Cache-Control': 'no-cache' } })
  })

  // ---- 分片上传（全局 body 限制 100kb，图片切片 base64 后逐片追加）----

  api('post', '/upload/begin', (req, res) => {
    pruneUploads()
    if (!fs.existsSync(CUSTOM_DIR)) fs.mkdirSync(CUSTOM_DIR, { recursive: true })
    const id = crypto.randomBytes(16).toString('hex')
    const p = path.join(CUSTOM_DIR, `.uploads-${id}`)
    try {
      fs.writeFileSync(p, '')
    } catch (err) {
      return fail(res, `创建上传会话失败：${err.message}`)
    }
    uploads.set(id, { path: p, size: 0, ts: Date.now() })
    ok(res, { id, chunk: UPLOAD_CHUNK })
  })

  api('post', '/upload/chunk', (req, res) => {
    const { id, u } = readUpload(req)
    if (!u) return fail(res, '上传会话不存在或已过期')
    let buf
    try {
      buf = Buffer.from(String(req.body?.data || ''), 'base64')
    } catch {
      return fail(res, '分片数据不合法')
    }
    if (!buf.length) return fail(res, '分片数据为空')
    if (u.size + buf.length > UPLOAD_MAX_SIZE) {
      discardUpload(id)
      return fail(res, '文件超过 20MB 上限，上传已取消')
    }
    try {
      fs.appendFileSync(u.path, buf)
    } catch (err) {
      discardUpload(id)
      return fail(res, `写入分片失败：${err.message}`)
    }
    u.size += buf.length
    u.ts = Date.now()
    ok(res, { size: u.size })
  })

  // 提交入库：不带 force 时只做重复性校验（id/名称/图片MD5 任一重复即返回 conflicts，会话保留可重试）；
  // 前端确认覆盖后带 force:true 重新提交落盘。文件名固定 {id}.<嗅探扩展名>，杜绝路径穿越
  api('post', '/upload/commit', (req, res) => {
    const { id, u } = readUpload(req)
    if (!u) return fail(res, '上传会话不存在或已过期')
    const pigId = String(req.body?.pigId || '').trim()
    const name = String(req.body?.name || '').trim()
    if (!PIG_ID_RE.test(pigId)) return fail(res, 'id 不合法（仅允许字母/数字/-/_，最长 64 字符）')
    if (!name) return fail(res, '请填写猪猪名称')
    try {
      const buf = fs.readFileSync(u.path)
      if (!buf.length) return fail(res, '上传内容为空')
      const md5 = crypto.createHash('md5').update(buf).digest('hex')
      const conflicts = checkConflicts({ id: pigId, name, md5 })
      if (conflicts.length && req.body?.force !== true) {
        return ok(res, { committed: false, conflicts })
      }
      const record = savePanelPig({
        id: pigId,
        name,
        description: String(req.body?.description || ''),
        analysis: String(req.body?.analysis || ''),
        image: buf,
        md5,
      })
      discardUpload(id)
      logger.info(`[猪猪图鉴] 面板上传猪猪「${record.name}」(${pigId})，${buf.length} 字节`)
      ok(res, { committed: true, conflicts, pig: pigView({ source: 'custom', file: PANEL_JSON_NAME, ...record }, String(Date.now())) })
    } catch (err) {
      logger.error(`[猪猪图鉴] 面板上传入库失败: ${err}`)
      fail(res, `保存失败：${err.message || err}`)
    }
  })

  api('post', '/upload/abort', (req, res) => {
    discardUpload(String(req.body?.id || ''))
    ok(res)
  })

  // ---- 增改 ----

  // 仅更新文案：官方 id / 扩展包 id 调用即以面板数据覆盖其显示（写入 custom-pigs.json）
  api('post', '/pig/save', (req, res) => {
    try {
      const pigId = String(req.body?.id || '').trim()
      const name = String(req.body?.name || '').trim()
      if (!PIG_ID_RE.test(pigId)) return fail(res, 'id 不合法（仅允许字母/数字/-/_，最长 64 字符）')
      if (!name) return fail(res, '请填写猪猪名称')
      const record = savePanelPig({
        id: pigId,
        name,
        description: String(req.body?.description || ''),
        analysis: String(req.body?.analysis || ''),
      })
      logger.info(`[猪猪图鉴] 面板保存文案「${record.name}」(${pigId})`)
      ok(res, { pig: pigView({ source: 'custom', file: PANEL_JSON_NAME, ...record }, String(Date.now())) })
    } catch (err) {
      logger.error(`[猪猪图鉴] 面板保存文案失败: ${err}`)
      fail(res, `保存失败：${err.message || err}`)
    }
  })

  // ---- 删 ----

  // 删除面板条目（仅 custom-pigs.json 管理的）：覆盖型条目删除后官方显示自动恢复
  api('post', '/pig/delete', (req, res) => {
    try {
      const pigId = String(req.body?.id || '').trim()
      if (!PIG_ID_RE.test(pigId)) return fail(res, 'id 不合法')
      const customEntry = listCustomPigs().find(c => c.id === pigId)
      if (!customEntry) return fail(res, '官方条目无法删除（如需覆盖其显示，直接编辑保存即可）')
      const { removed, managed } = deletePanelPig(pigId)
      if (!managed) {
        return fail(res, `该条目来自扩展包 ${customEntry.file}，请在对应 json 文件中删除`)
      }
      logger.info(`[猪猪图鉴] 面板删除猪猪 (${pigId})`)
      ok(res, { removed })
    } catch (err) {
      logger.error(`[猪猪图鉴] 面板删除失败: ${err}`)
      fail(res, `删除失败：${err.message || err}`)
    }
  })

  // ---- VLM 文案生成 ----

  // imageSource: { type: 'upload', id: uploadId }（刚分片上传的图片）或 { type: 'pig', id }（已有条目图片）
  api('post', '/vlm', async (req, res) => {
    try {
      const name = String(req.body?.name || '').trim()
      const note = String(req.body?.note || '').trim()
      if (!name) return fail(res, '请先填写猪猪名称')
      const src = req.body?.imageSource || {}
      let imageBuffer = null
      let imageExt = '.png'
      if (src.type === 'upload') {
        const hit = uploads.get(String(src.id || ''))
        if (!hit) return fail(res, '上传会话不存在或已过期，请重新选择图片')
        imageBuffer = fs.readFileSync(hit.path)
      } else if (src.type === 'pig') {
        const pigId = String(src.id || '')
        if (!PIG_ID_RE.test(pigId)) return fail(res, 'id 不合法')
        const imagePath = findPigImageAny(pigId)
        if (!imagePath) return fail(res, '该猪猪暂无图片，无法生成文案')
        imageBuffer = fs.readFileSync(imagePath)
        imageExt = path.extname(imagePath) || '.png'
      }
      if (!imageBuffer?.length) return fail(res, '缺少图片：请先上传图片或选择已有条目')
      logger.info(`[猪猪图鉴] 面板 VLM 生成文案：「${name}」，${imageBuffer.length} 字节图片`)
      const copy = await generatePigCopy({ name, note, imageBuffer, imageExt })
      ok(res, copy)
    } catch (err) {
      logger.error(`[猪猪图鉴] VLM 生成失败: ${err}`)
      fail(res, `生成失败：${err.message || err}`)
    }
  })
}

export { init }
