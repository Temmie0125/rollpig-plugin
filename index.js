import plugin from '../../lib/plugins/plugin.js'
import fs from 'fs'
import { segment } from 'oicq'
import { createRequire } from 'module'
import path from 'path'
import { fileURLToPath } from 'url'

const require = createRequire(import.meta.url)
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export class RollPigPlugin extends plugin {
  constructor() {
    super({
      name: '今天是什么小猪',
      dsc: '抽取属于自己的小猪',
      event: 'message',
      priority: 5000,
      rule: [
        {
          reg: '^#?(今日小猪|今天是什么小猪|本日小猪|当日小猪)$',
          fnc: 'todayPig'
        },
        {
          reg: '^#?随机小猪\\s*(\\d+)?$',
          fnc: 'randomPig'
        },
        {
          reg: '^#?(找猪|搜猪)\\s+(.+)$',
          fnc: 'findPig'
        }
      ]
    })

    this.pigData = []
    this.pigCache = []
    this.userRecords = {}
    this.loadData()
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
    } catch (err) {
      logger.error('[今天是什么小猪] 数据加载失败:', err)
    }
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

  async todayPig(e) {
    const userId = e.user_id.toString()
    const today = new Date().toLocaleDateString('zh-CN')
    
    if (this.userRecords[userId]?.date === today) {
      const pigId = this.userRecords[userId].pig_id
      const pig = this.pigData.find(p => p.id === pigId)
      if (pig) {
        await this.sendPigCard(e, pig)
        return true
      }
    }

    const pig = this.pigData[Math.floor(Math.random() * this.pigData.length)]
    this.userRecords[userId] = { pig_id: pig.id, date: today }
    this.saveRecords()
    
    await this.sendPigCard(e, pig)
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
        const imageUrl = `https://pighub.top/data/${pig.thumbnail.split('/').pop()}`
        await e.reply(segment.image(imageUrl))
      } else {
        const selected = []
        const available = [...this.pigCache]
        for (let i = 0; i < Math.min(count, available.length); i++) {
          const idx = Math.floor(Math.random() * available.length)
          selected.push(available.splice(idx, 1)[0])
        }
        
        const msgs = selected.map(pig => {
          const imageUrl = `https://pighub.top/data/${pig.thumbnail.split('/').pop()}`
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
        const imageUrl = `https://pighub.top/data/${pig.thumbnail.split('/').pop()}`
        await e.reply([`${pig.title}-${pig.id}`, segment.image(imageUrl)])
      } else {
        const msgs = found.slice(0, 20).map(pig => {
          const imageUrl = `https://pighub.top/data/${pig.thumbnail.split('/').pop()}`
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

  async refreshPigHub() {
    try {
      const response = await fetch('https://pighub.top/api/all-images')
      const data = await response.json()
      if (data?.images) {
        this.pigCache = data.images
        logger.info(`[今天是什么小猪] 从 PigHub 缓存了 ${this.pigCache.length} 头猪猪`)
      }
    } catch (err) {
      logger.error('[今天是什么小猪] PigHub 刷新失败:', err)
    }
  }

  async sendPigCard(e, pig) {
    const imagePath = this.findPigImage(pig.id)
    if (!imagePath) {
      await e.reply(`${pig.name}\n${pig.description}\n${pig.analysis}`)
      return
    }

    const msg = [
      segment.image(`file:///${imagePath}`),
      `\n【${pig.name}】\n${pig.description}\n\n${pig.analysis}`
    ]
    await e.reply(msg)
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
