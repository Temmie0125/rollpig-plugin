// 插件配置统一入口：默认值、读取、保存都集中在这里，避免 index.js / guoba.support.js / vlm.js 三处默认值漂移。
// 配置键必须保持顶层扁平，锅巴不支持 vlm.xxx 这类嵌套 key。
import fs from 'fs'
import path from 'path'
import yaml from 'yaml'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const PLUGIN_ROOT = path.resolve(__dirname, '..')
export const CONFIG_DIR = path.join(PLUGIN_ROOT, 'config')
export const DEFAULT_CONFIG_PATH = path.join(CONFIG_DIR, 'config.default.yaml')
export const USER_CONFIG_PATH = path.join(CONFIG_DIR, 'config.yaml')

export const DEFAULT_CONFIG = {
  markdown: false,
  vlmApiUrl: '',
  vlmApiKey: '',
  vlmModel: '',
  aiRoastEnabled: false,
  roastCooldownHours: 8,
  roastChargeMax: 2,
  dailyReportDefault: false
}

const readYaml = file => {
  try {
    const parsed = yaml.parse(fs.readFileSync(file, 'utf8'))
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

export const toBool = (value, fallback = false) => {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value !== 0
  if (typeof value !== 'string') return fallback
  const text = value.trim().toLowerCase()
  if (['true', '1', 'on', 'yes', '开启', '启用'].includes(text)) return true
  if (['false', '0', 'off', 'no', '关闭', '停用', ''].includes(text)) return false
  return fallback
}

const toNumber = (value, fallback, min, max) => {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.min(max, Math.max(min, number))
}

/** 统一把 YAML 里可能出现的字符串转换成运行期需要的类型 */
export const normalizeConfig = raw => {
  const config = { ...DEFAULT_CONFIG, ...(raw || {}) }
  config.markdown = toBool(config.markdown, false)
  config.aiRoastEnabled = toBool(config.aiRoastEnabled, false)
  config.dailyReportDefault = toBool(config.dailyReportDefault, false)
  config.vlmApiUrl = String(config.vlmApiUrl || '').trim()
  config.vlmApiKey = String(config.vlmApiKey || '').trim()
  config.vlmModel = String(config.vlmModel || '').trim()
  config.roastCooldownHours = toNumber(config.roastCooldownHours, 8, 0.0167, 168)
  config.roastChargeMax = Math.trunc(toNumber(config.roastChargeMax, 2, 1, 6))
  return config
}

/** 读取配置：代码默认值 < config.default.yaml < config.yaml */
export const readConfig = () => {
  try {
    if (!fs.existsSync(USER_CONFIG_PATH) && fs.existsSync(DEFAULT_CONFIG_PATH)) {
      fs.mkdirSync(CONFIG_DIR, { recursive: true })
      fs.copyFileSync(DEFAULT_CONFIG_PATH, USER_CONFIG_PATH)
    }
    const defaults = readYaml(DEFAULT_CONFIG_PATH)
    const user = readYaml(USER_CONFIG_PATH)
    return normalizeConfig({ ...defaults, ...user })
  } catch (error) {
    ;(globalThis.logger || console).error?.('[今天是什么小猪] 配置读取失败:', error)
    return { ...DEFAULT_CONFIG }
  }
}

/** 覆盖写入用户配置；写之前先保证默认文件存在，方便首次部署查看说明 */
export const saveConfig = config => {
  try {
    fs.mkdirSync(CONFIG_DIR, { recursive: true })
    if (!fs.existsSync(USER_CONFIG_PATH) && fs.existsSync(DEFAULT_CONFIG_PATH)) {
      fs.copyFileSync(DEFAULT_CONFIG_PATH, USER_CONFIG_PATH)
    }
    const normalized = normalizeConfig(config)
    fs.writeFileSync(USER_CONFIG_PATH, yaml.stringify(normalized), 'utf8')
    return normalized
  } catch (error) {
    ;(globalThis.logger || console).error?.('[今天是什么小猪] 配置保存失败:', error)
    throw error
  }
}

/** 只更新指定字段，其余用户配置保持不变 */
export const updateConfig = patch => {
  const current = readConfig()
  return saveConfig({ ...current, ...(patch || {}) })
}

export const isVlmConfigured = config => {
  const cfg = normalizeConfig(config || readConfig())
  return Boolean(cfg.vlmApiUrl && cfg.vlmApiKey && cfg.vlmModel)
}
