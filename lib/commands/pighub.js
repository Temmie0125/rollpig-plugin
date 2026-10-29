// PigHub 随机/搜索。缓存挂 globalThis，修复 TRSS 每条消息重新实例化导致定时刷新不可见的问题。
import { segment } from 'oicq'
import { touchContext } from './helpers.js'

const CACHE_KEY = '__rollpig_pighub_cache'

const cache = () => {
  globalThis[CACHE_KEY] ||= { images: [], refreshing: null }
  return globalThis[CACHE_KEY]
}

export const pigImageUrl = pig => {
  const raw = pig?.image_url || pig?.thumbnail
  if (!raw) return ''
  try {
    return new URL(raw, 'https://pighub.top/').href
  } catch {
    return raw
  }
}

export const refreshPigHub = () => {
  const state = cache()
  if (state.refreshing) return state.refreshing
  state.refreshing = (async () => {
    const url = 'https://pighub.top/api/images?sort=2'
    let lastError
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const response = await fetch(url, {
          headers: { Accept: 'application/json', 'User-Agent': 'Yunzai-RollPig/2.0' },
          signal: AbortSignal.timeout(15_000)
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
        if (data?.code !== 0 || !Array.isArray(data.data)) throw new Error(data?.message || '响应格式不正确')
        const images = data.data
          .filter(pig => pig && pig.title && (pig.image_url || pig.thumbnail))
          .map(pig => ({ ...pig, thumbnail: pig.image_url || pig.thumbnail }))
        if (!images.length) throw new Error('图片列表为空')
        state.images = images
        ;(globalThis.logger || console).info?.(`[今天是什么小猪] 从 PigHub 缓存了 ${images.length} 头猪猪`)
        return true
      } catch (error) {
        lastError = error
        if (attempt < 3) await new Promise(resolve => setTimeout(resolve, 3000 * attempt))
      }
    }
    ;(globalThis.logger || console).error?.('[今天是什么小猪] PigHub 刷新失败:', lastError)
    return false
  })().finally(() => {
    state.refreshing = null
  })
  return state.refreshing
}

const ensureCache = async () => {
  const state = cache()
  if (!state.images.length) await refreshPigHub()
  return state.images
}

export const randomPig = async (e) => {
  await touchContext(e)
  const match = e.msg.match(/^#?随机小猪\s*(\d+)?$/)
  const count = Math.min(Math.max(match?.[1] ? parseInt(match[1], 10) : 1, 1), 20)
  try {
    const images = await ensureCache()
    if (!images.length) {
      await e.reply('猪圈空荡荡...')
      return true
    }
    if (count === 1) {
      const pig = images[Math.floor(Math.random() * images.length)]
      await e.reply(segment.image(pigImageUrl(pig)))
    } else {
      const selected = []
      const available = [...images]
      for (let index = 0; index < Math.min(count, available.length); index++) {
        const pick = Math.floor(Math.random() * available.length)
        selected.push(available.splice(pick, 1)[0])
      }
      const messages = selected.map(pig => ({
        message: [pig.title, segment.image(pigImageUrl(pig))],
        nickname: pig.title,
        user_id: e.self_id
      }))
      await e.reply(await e.group.makeForwardMsg(messages))
    }
  } catch (error) {
    ;(globalThis.logger || console).error?.('[随机小猪] 错误:', error)
    await e.reply('获取小猪失败了...')
  }
  return true
}

export const findPig = async (e) => {
  await touchContext(e)
  const match = e.msg.match(/^#?(找猪|搜猪)\s+(.+)$/)
  const keyword = match?.[2]?.trim().toLowerCase() || ''
  try {
    const images = await ensureCache()
    if (!images.length) {
      await e.reply('猪圈空荡荡...')
      return true
    }
    const found = images.filter(pig => String(pig.title || '').toLowerCase().includes(keyword))
    if (!found.length) {
      await e.reply('你要找的猪仔离家出走了~')
      return true
    }
    if (found.length === 1) {
      const pig = found[0]
      await e.reply([`${pig.title}-${pig.id}`, segment.image(pigImageUrl(pig))])
      return true
    }
    const messages = found.slice(0, 20).map(pig => ({
      message: [`${pig.title}-${pig.id}`, segment.image(pigImageUrl(pig))],
      nickname: pig.title,
      user_id: e.self_id
    }))
    await e.reply(await e.group.makeForwardMsg(messages))
  } catch (error) {
    ;(globalThis.logger || console).error?.('[找猪] 错误:', error)
    await e.reply('找猪失败了...')
  }
  return true
}
