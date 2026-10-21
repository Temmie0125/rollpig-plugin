import plugin from '../../lib/plugins/plugin.js'
import fs from 'fs'
import { segment } from 'oicq'
import { createRequire } from 'module'
import path from 'path'
import { fileURLToPath, pathToFileURL } from 'url'
import yaml from 'yaml'
import puppeteer from '../../lib/puppeteer/puppeteer.js'

const require = createRequire(import.meta.url)
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

/** 默认配置，与 config/config.default.yaml 保持一致 */
const DEFAULT_CONFIG = {
  /** Markdown回复：官方QQBot 使用 Markdown 格式回复（@用户 + 引用块 + 按钮） */
  markdown: false
}

export class RollPigPlugin extends plugin {
  constructor() {
    super({
      name: '今天是什么小猪',
      dsc: '抽取属于自己的小猪',
      event: 'message',
      priority: 5000,
      rule: [
        {
          reg: '^#?(今日小猪|今天是什么小猪|本日小猪|当日小猪|今日猪猪)$',
          fnc: 'todayPig'
        },
        {
          reg: '^#?随机小猪\\s*(\\d+)?$',
          fnc: 'randomPig'
        },
        {
          reg: '^#?(找猪|搜猪)\\s+(.+)$',
          fnc: 'findPig'
        },
        {
          reg: '^#?(猪圈|猪猪图鉴|我的猪圈)\\s*$',
          fnc: 'pigPen'
        },
        {
          reg: '^#?猪猪设置\\s*markdown\\s*(开启|关闭|on|off)\\s*$',
          fnc: 'setMarkdown',
          permission: 'master'
        }
      ]
    })

    this.pigData = []
    this.pigCache = []
    this.userRecords = {}
    this.config = { ...DEFAULT_CONFIG }
    this.loadData()
    this.config = this.loadConfig()

    // 每日0点刷新PigHub缓存，由宿主loader统一调度；仅内存缓存，不会写入本地图鉴库与用户记录
    this.task = { name: 'PigHub数据刷新', cron: '0 0 * * *', fnc: () => this.refreshPigHub() }
  }

  loadData() {
    try {
      const pigJsonPath = path.join(__dirname, 'resource', 'pig.json')
      this.pigData = JSON.parse(fs.readFileSync(pigJsonPath, 'utf-8'))
      logger.info(`[今天是什么小猪] 加载了 ${this.pigData.length} 条小猪数据`)

      const recordPath = path.join(__dirname, 'data', 'records.json')
      if (fs.existsSync(recordPath)) {
        this.userRecords = JSON.parse(fs.readFileSync(recordPath, 'utf-8'))
      }
      // 旧版记录（{ pig_id, date }）迁移为计数格式
      for (const id in this.userRecords) {
        this.migrateRecord(this.userRecords[id])
      }
    } catch (err) {
      logger.error('[今天是什么小猪] 数据加载失败:', err)
    }
  }

  /** 旧版单条记录迁移：补齐 pigs 计数与 total */
  migrateRecord(record) {
    if (!record || typeof record !== 'object') return record
    if (!record.pigs || typeof record.pigs !== 'object') {
      record.pigs = record.pig_id ? { [record.pig_id]: 1 } : {}
    }
    if (typeof record.total !== 'number') {
      record.total = Object.values(record.pigs).reduce((sum, n) => sum + (Number(n) || 0), 0)
    }
    return record
  }

  /** 获取用户记录，不存在时创建空记录 */
  getUserRecord(userId) {
    if (!this.userRecords[userId]) {
      this.userRecords[userId] = { pigs: {}, total: 0 }
    }
    return this.migrateRecord(this.userRecords[userId])
  }

  saveRecords() {
    try {
      const dataDir = path.join(__dirname, 'data')
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true })
      }
      const recordPath = path.join(dataDir, 'records.json')
      fs.writeFileSync(recordPath, JSON.stringify(this.userRecords, null, 2))
    } catch (err) {
      logger.error('[今天是什么小猪] 记录保存失败:', err)
    }
  }

  loadConfig() {
    const configDir = path.join(__dirname, 'config')
    const defaultPath = path.join(configDir, 'config.default.yaml')
    const userPath = path.join(configDir, 'config.yaml')
    let config = { ...DEFAULT_CONFIG }
    try {
      if (!fs.existsSync(userPath)) {
        if (!fs.existsSync(configDir)) fs.mkdirSync(configDir, { recursive: true })
        if (fs.existsSync(defaultPath)) {
          fs.copyFileSync(defaultPath, userPath)
        } else {
          fs.writeFileSync(userPath, yaml.stringify(DEFAULT_CONFIG))
        }
      }
      config = { ...config, ...(yaml.parse(fs.readFileSync(userPath, 'utf-8')) || {}) }
    } catch (err) {
      logger.error('[今天是什么小猪] 配置加载失败，使用默认配置:', err)
    }
    return config
  }

  saveConfig() {
    try {
      const configDir = path.join(__dirname, 'config')
      if (!fs.existsSync(configDir)) fs.mkdirSync(configDir, { recursive: true })
      fs.writeFileSync(path.join(configDir, 'config.yaml'), yaml.stringify(this.config))
    } catch (err) {
      logger.error('[今天是什么小猪] 配置保存失败:', err)
    }
  }

  /** 是否官方QQBot适配器（QQ群/私聊/QQ频道） */
  isQQBot(e) {
    const platform = String(e.platform || '')
    return platform.startsWith('QQ') || platform.startsWith('guild')
  }

  /** 今日小猪回复按钮：跳转猪圈/再抽 */
  drawButtons() {
    if (typeof segment.button !== 'function') return null
    return segment.button([
      { text: '👑 猪圈', input: '#猪圈' },
      { text: '🐷 今日猪猪', input: '#今日猪猪' }
    ])
  }

  /** 猪圈回复按钮：方便其他群友直接抽取/查看自己的图鉴 */
  penButtons() {
    if (typeof segment.button !== 'function') return null
    return segment.button([
      { text: '🐷 今日猪猪', input: '#今日猪猪' },
      { text: '📖 我的猪圈', input: '#我的猪圈' }
    ])
  }

  async todayPig(e) {
    const userId = e.user_id.toString()
    const today = new Date().toLocaleDateString('zh-CN')
    let pig, count, hint

    const record = this.userRecords[userId]
    if (record?.date === today) {
      pig = this.pigData.find(p => p.id === record.pig_id)
      if (pig) {
        count = record.pigs[pig.id] || 1
        hint = '今天已经抽过啦，这是你的今日小猪~'
        await this.replyDraw(e, pig, count, hint)
        return true
      }
    }

    pig = this.pigData[Math.floor(Math.random() * this.pigData.length)]
    const rec = this.getUserRecord(userId)
    rec.date = today
    rec.pig_id = pig.id
    rec.pigs[pig.id] = (rec.pigs[pig.id] || 0) + 1
    rec.total = (rec.total || 0) + 1
    count = rec.pigs[pig.id]
    hint = count === 1
      ? '🎉 抓到一只新猪猪啦！'
      : `🔁 第 ${count} 次抽到这只猪猪，升级 Lv.${count}！`
    this.saveRecords()

    await this.replyDraw(e, pig, count, hint)
    return true
  }

  /** 回复抽卡结果：Markdown模式（官方QQBot）或普通图片模式 */
  async replyDraw(e, pig, count, hint) {
    const title = count > 1 ? `${pig.name} Lv.${count}` : pig.name
    const imagePath = this.findPigImage(pig.id)
    const buttons = this.drawButtons()

    if (this.config.markdown && this.isQQBot(e) && imagePath) {
      const quote = pig.analysis.split('\n').map(line => `> ${line}`).join('\n')
      const msg = [
        segment.at(e.user_id),
        `\n${hint}\n`,
        segment.image(`file:///${imagePath}`),
        `\n**【${title}】**\n${pig.description}\n${quote}`
      ]
      if (buttons) msg.push(buttons)
      await e.reply(msg)
      return
    }

    if (!imagePath) {
      await e.reply(`${hint}\n【${title}】\n${pig.description}\n${pig.analysis}`)
      return
    }

    await e.reply([
      segment.image(`file:///${imagePath}`),
      `\n${hint}\n【${title}】\n${pig.description}\n\n${pig.analysis}`
    ])
  }

  /** 猪圈统计：已收集数、收集率、本命猪（抽到次数最多的猪猪） */
  penStats(userId) {
    const record = this.userRecords[userId]
    const collected = record
      ? Object.values(record.pigs || {}).filter(n => n > 0).length
      : 0
    const total = this.pigData.length
    const percent = total ? (collected / total * 100).toFixed(2) : '0.00'

    let bestPig = null
    let bestCount = 0
    for (const [pigId, count] of Object.entries(record?.pigs || {})) {
      if (count > bestCount) {
        const pig = this.pigData.find(p => p.id === pigId)
        // 图鉴中已移除的猪猪不计入本命猪
        if (pig) {
          bestPig = pig
          bestCount = count
        }
      }
    }
    return { collected, total, percent, bestPig, bestCount }
  }

  /** 从用户缓存表获取用户昵称：好友列表 → 群成员列表 → 消息自带发送者信息，获取不到返回 null */
  getUserNickname(e, userId) {
    // 适配器缓存键与 e.user_id 同源（QQBot 为字符串、OneBot 为数字），目标为本人时保留原始类型，两种形态都尝试
    const keys = [...new Set([
      String(e?.user_id) === userId ? e.user_id : null,
      userId,
      Number(userId)
    ].filter(key => key != null && !(typeof key === 'number' && Number.isNaN(key))))]

    // 好友缓存：QQBot 群聊消息也会写入，可补上私信场景不下发的昵称
    for (const key of keys) {
      const friend = Bot.fl?.get?.(key)
      if (friend?.nickname || friend?.remark) return friend.nickname || friend.remark
    }

    // 群成员缓存：card 为群名片，nickname 为QQ昵称
    for (const members of Bot.gml?.values?.() || []) {
      for (const key of keys) {
        const member = members.get?.(key)
        if (member?.card || member?.nickname) return member.card || member.nickname
      }
    }

    if (String(e?.user_id) === userId && (e?.sender?.card || e?.sender?.nickname)) {
      return e.sender.card || e.sender.nickname
    }
    return null
  }

  /** 猪圈消息头：群聊内@目标；私信没有@，以用户昵称代替，实在获取不到时用“你”/“TA”占位 */
  penHeader(e, userId, isSelf) {
    if (e.isGroup || e.group) return [`【`, segment.at(userId), ` 的猪圈】`]
    const nickname = this.getUserNickname(e, userId) || (isSelf ? '你' : 'TA')
    return [`【${nickname}的猪圈】`]
  }

  /** #猪圈：查看个人猪猪图鉴与收集进度，可@查看他人 */
  async pigPen(e) {
    let userId = e.user_id.toString()
    let isSelf = true

    // 官方QQBot群内命令往往需要@Bot才能触发，@Bot不能被当成代查目标：
    // 群聊路径适配器已把@本Bot归入atBot/atme而不写入e.at，这里再兜底比对self_id；
    // 频道(guild)每条命令都必须@Bot且@段格式与普通成员一致，无法区分，直接忽略代查
    let at = e.at ? String(e.at) : null
    if (at && at === String(e.self_id)) at = null
    if (String(e.platform || '').startsWith('guild')) at = null

    if (at && at !== userId) {
      userId = at
      isSelf = false
    }

    const { collected, total, percent, bestPig, bestCount } = this.penStats(userId)

    if (!collected) {
      await e.reply(isSelf
        ? '你的猪圈还空空如也，快发送 #今日小猪 抽一只猪猪吧~'
        : 'TA的猪圈还空空如也，让TA发送 #今日小猪 抽一只猪猪吧~')
      return true
    }

    // 头部文本统计：【@xxx 的猪圈】+ 已收集/收集率/本命猪
    const stats = [
      `📦 已收集: ${collected} / ${total}`,
      `⭐ 收集率: ${percent}%`
    ]
    if (bestPig) {
      stats.push(`🐷 本命猪: 【${bestPig.name}】Lv.${bestCount}（抓到过${bestCount}次）`)
    }

    const header = this.penHeader(e, userId, isSelf)

    try {
      const image = await this.renderPen(userId)
      if (!image) throw new Error('渲染器返回空图片')

      const msg = [...header, `\n${stats.join('\n')}\n`, image]
      const buttons = this.penButtons()
      if (this.config.markdown && this.isQQBot(e) && buttons) msg.push(buttons)
      await e.reply(msg)
    } catch (err) {
      logger.error('[猪圈] 渲染失败:', err)
      await e.reply([...header, `\n${stats.join('\n')}`])
    }
    return true
  }

  /** 渲染猪猪图鉴图片 */
  async renderPen(userId) {
    const record = this.migrateRecord(this.userRecords[userId] || { pigs: {}, total: 0 })
    const pigs = this.pigData.map(p => {
      const level = record.pigs[p.id] || 0
      const imagePath = this.findPigImage(p.id)
      return {
        name: p.name,
        level,
        unlocked: level > 0,
        image: pathToFileURL(imagePath || path.join(__dirname, 'resource', 'image', 'pig.png')).href
      }
    })
    const total = pigs.length
    const collected = pigs.filter(p => p.unlocked).length

    // 根据本地猪猪数量自适应列数与画布宽度，扩充图鉴库时无需调整模板
    const columns = Math.min(14, Math.max(4, Math.ceil(Math.sqrt(total * 0.9))))
    const penWidth = columns * 150 + 80
    const titleSize = Math.min(88, Math.max(48, Math.round(penWidth / 10)))

    return await puppeteer.screenshot('rollpig-pen', {
      tplFile: path.join(__dirname, 'resource', 'pen.html'),
      saveId: 'rollpig-pen',
      imgType: 'png',
      collected,
      total,
      percent: total ? (collected / total * 100).toFixed(2) : '0.00',
      totalDraws: record.total || 0,
      columns,
      penWidth,
      titleSize,
      pigs
    })
  }

  /** #猪猪设置markdown：管理员切换 Markdown回复 */
  async setMarkdown(e) {
    const on = /开启|on/i.test(e.msg)
    this.config.markdown = on
    this.saveConfig()
    await e.reply(`Markdown回复已${on ? '开启' : '关闭'}${on ? '，官方QQBot将使用Markdown格式回复' : ''}`)
    return true
  }

  async randomPig(e) {
    const match = e.msg.match(/^#?随机小猪\s*(\d+)?$/)
    let count = match[1] ? parseInt(match[1]) : 1
    count = Math.min(Math.max(count, 1), 20)

    try {
      if (!this.pigCache.length) {
        await this.refreshPigHub()
      }

      if (!this.pigCache.length) {
        await e.reply('猪圈空荡荡...')
        return true
      }

      if (count === 1) {
        const pig = this.pigCache[Math.floor(Math.random() * this.pigCache.length)]
        const imageUrl = this.pigImageUrl(pig)
        await e.reply(segment.image(imageUrl))
      } else {
        const selected = []
        const available = [...this.pigCache]
        for (let i = 0; i < Math.min(count, available.length); i++) {
          const idx = Math.floor(Math.random() * available.length)
          selected.push(available.splice(idx, 1)[0])
        }

        const msgs = selected.map(pig => {
          const imageUrl = this.pigImageUrl(pig)
          return {
            message: [pig.title, segment.image(imageUrl)],
            nickname: pig.title,
            user_id: e.self_id
          }
        })
        await e.reply(await e.group.makeForwardMsg(msgs))
      }
    } catch (err) {
      logger.error('[随机小猪] 错误:', err)
      await e.reply('获取小猪失败了...')
    }
    return true
  }

  async findPig(e) {
    const match = e.msg.match(/^#?(找猪|搜猪)\s+(.+)$/)
    const keyword = match[2].trim().toLowerCase()

    try {
      if (!this.pigCache.length) {
        await this.refreshPigHub()
      }

      if (!this.pigCache.length) {
        await e.reply('猪圈空荡荡...')
        return true
      }

      const found = this.pigCache.filter(pig =>
        pig.title.toLowerCase().includes(keyword)
      )

      if (!found.length) {
        await e.reply('你要找的猪仔离家出走了~')
        return true
      }

      if (found.length === 1) {
        const pig = found[0]
        const imageUrl = this.pigImageUrl(pig)
        await e.reply([`${pig.title}-${pig.id}`, segment.image(imageUrl)])
      } else {
        const msgs = found.slice(0, 20).map(pig => {
          const imageUrl = this.pigImageUrl(pig)
          return {
            message: [`${pig.title}-${pig.id}`, segment.image(imageUrl)],
            nickname: pig.title,
            user_id: e.self_id
          }
        })
        await e.reply(await e.group.makeForwardMsg(msgs))
      }
    } catch (err) {
      logger.error('[找猪] 错误:', err)
      await e.reply('找猪失败了...')
    }
    return true
  }

  /** PigHub 图片 URL：新接口返回相对路径 image_url，旧缓存字段为 thumbnail */
  pigImageUrl(pig) {
    const raw = pig?.image_url || pig?.thumbnail
    if (!raw) return ''
    try {
      return new URL(raw, 'https://pighub.top/').href
    } catch {
      return raw
    }
  }

  async refreshPigHub() {
    // 并发去重：每日任务与随机/搜索命令可能同时触发刷新
    if (this._pigHubRefreshing) return this._pigHubRefreshing

    this._pigHubRefreshing = (async () => {
      // PigHub 接口已从 /api/all-images 迁移为 /api/images?sort=<0名称|1最早|2最新|3热门>；
      // 旧接口现在返回 404 空响应，response.json() 会抛 "Unexpected end of JSON input"
      const url = 'https://pighub.top/api/images?sort=2'
      let lastErr
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          const response = await fetch(url, {
            headers: {
              Accept: 'application/json',
              'User-Agent': 'Yunzai-RollPig/1.0'
            },
            signal: AbortSignal.timeout(15000)
          })
          if (!response.ok) throw new Error(`HTTP ${response.status}`)

          const text = await response.text()
          if (!text.trim()) throw new Error('响应为空')

          let data
          try {
            data = JSON.parse(text)
          } catch {
            throw new Error(`响应不是合法 JSON: ${text.slice(0, 80)}`)
          }
          if (data?.code !== 0 || !Array.isArray(data.data))
            throw new Error(data?.message || '响应格式不正确')

          const images = data.data
            .filter(pig => pig && pig.title && (pig.image_url || pig.thumbnail))
            .map(pig => ({ ...pig, thumbnail: pig.image_url || pig.thumbnail }))
          if (!images.length) throw new Error('图片列表为空')

          this.pigCache = images
          logger.info(`[今天是什么小猪] 从 PigHub 缓存了 ${this.pigCache.length} 头猪猪`)
          return true
        } catch (err) {
          lastErr = err
          if (attempt < 3) await new Promise(resolve => setTimeout(resolve, 3000 * attempt))
        }
      }
      logger.error('[今天是什么小猪] PigHub 刷新失败:', lastErr)
      return false
    })().finally(() => {
      this._pigHubRefreshing = null
    })

    return this._pigHubRefreshing
  }

  findPigImage(pigId) {
    const imageDir = path.join(__dirname, 'resource', 'image')
    const extensions = ['png', 'jpg', 'jpeg', 'gif', 'webp']

    for (const ext of extensions) {
      const imagePath = path.join(imageDir, `${pigId}.${ext}`)
      if (fs.existsSync(imagePath)) {
        return imagePath
      }
    }
    return null
  }
}
