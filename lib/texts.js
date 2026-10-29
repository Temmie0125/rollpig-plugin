// 所有硬编码文案集中从 resource/texts.json 读取；该文件由参考插件 texts.py 一次性导出。
// 占位符与 Python 版保持一致：{pig} {level} {old_level} {new_level} {attacker} {target} ...
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const TEXT_PATH = path.resolve(__dirname, '..', 'resource', 'texts.json')

const load = () => {
  try {
    return JSON.parse(fs.readFileSync(TEXT_PATH, 'utf8'))
  } catch (error) {
    ;(globalThis.logger || console).error?.('[今天是什么小猪] texts.json 读取失败:', error)
    return {}
  }
}

export const texts = load()
export const T = texts

export const pickText = (pool, random = Math.random) => {
  if (!Array.isArray(pool) || !pool.length) return ''
  return pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))]
}

export const formatText = (template, values = {}) =>
  String(template || '').replace(/\{([A-Za-z0-9_]+)\}/g, (match, key) =>
    Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : match
  )

/** 按业务身份稳定选句：同一日期/用户/群/家族永远得到同一句 */
export const stablePick = (pool, ...parts) => {
  if (!Array.isArray(pool) || !pool.length) return ''
  const version = String(texts.YESTERDAY_RECAP_TEXT_VERSION || '1')
  const seed = [version, ...parts.map(part => String(part))].join('\u001f')
  const digest = crypto.createHash('sha256').update(seed).digest()
  const index = Number(digest.readBigUInt64BE(0) % BigInt(pool.length))
  return pool[index]
}
