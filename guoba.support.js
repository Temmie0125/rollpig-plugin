// 锅巴（Guoba）配置页：Markdown 回复开关 + VLM 文案生成配置
// 与 #猪猪设置markdown 命令共用 config/config.yaml，字段全部为顶层扁平 key
// （嵌套点号 key 会导致锅巴保存时报「请先修正表单中的错误」，切勿改成 vlm.xxx 形式）
import fs from 'fs'
import path from 'path'
import yaml from 'yaml'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const CONFIG_DIR = path.join(__dirname, 'config')
const DEFAULT_PATH = path.join(CONFIG_DIR, 'config.default.yaml')
const USER_PATH = path.join(CONFIG_DIR, 'config.yaml')

const DEFAULT_CONFIG = {
  markdown: false,
  vlmApiUrl: '',
  vlmApiKey: '',
  vlmModel: '',
}

const readUserConfig = () => {
  let base = { ...DEFAULT_CONFIG }
  try {
    base = { ...base, ...(yaml.parse(fs.readFileSync(DEFAULT_PATH, 'utf-8')) || {}) }
  } catch {}
  try {
    base = { ...base, ...(yaml.parse(fs.readFileSync(USER_PATH, 'utf-8')) || {}) }
  } catch {}
  return base
}

const writeUserConfig = (patch) => {
  const merged = { ...readUserConfig() }
  for (const key of Object.keys(DEFAULT_CONFIG)) {
    if (patch[key] === undefined) continue
    if (key === 'markdown') {
      merged.markdown = patch.markdown === true || patch.markdown === 'true' || patch.markdown === '开启'
    } else {
      merged[key] = String(patch[key]).trim()
    }
  }
  if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true })
  fs.writeFileSync(USER_PATH, yaml.stringify(merged))
}

export const supportGuoba = () => ({
  pluginInfo: {
    name: 'rollpig-plugin',
    title: '今天是什么小猪',
    description: '每日抽取专属小猪、收集图鉴，支持自定义图鉴扩展与面板管理',
    author: '@Temmie0125',
    authorLink: 'https://github.com/Temmie0125',
    link: 'https://github.com/Temmie0125/rollpig-plugin',
    isV3: true,
    isV2: false,
    showInMenu: 'auto',
  },
  configInfo: {
    schemas: [
      {
        field: 'markdown',
        label: 'Markdown 回复',
        helpMessage: '官方QQBot使用Markdown格式回复（@用户 + 引用块 + 按钮），其他平台自动回退；也可用命令 #猪猪设置markdown开启/关闭',
        component: 'Switch',
      },
      {
        component: 'SOFT_GROUP_BEGIN',
        label: 'AI 文案生成（VLM）',
        helpMessage: '供管理面板「猪猪图鉴管理」的 AI 生成文案使用；协议为 OpenAI 兼容 chat/completions，三项全部填写后生效',
      },
      {
        field: 'vlmApiUrl',
        label: 'API 地址',
        helpMessage: 'OpenAI 兼容接口地址，如 https://api.example.com/v1',
        component: 'Input',
      },
      {
        field: 'vlmApiKey',
        label: 'API Key',
        component: 'InputPassword',
      },
      {
        field: 'vlmModel',
        label: '视觉模型',
        helpMessage: '支持图片输入的模型名，如 qwen-vl-plus / gpt-4o-mini / glm-4v-flash',
        component: 'Input',
      },
    ],
    getConfigData() {
      const cfg = readUserConfig()
      return {
        markdown: cfg.markdown !== false && cfg.markdown !== 'false',
        vlmApiUrl: String(cfg.vlmApiUrl || ''),
        vlmApiKey: String(cfg.vlmApiKey || ''),
        vlmModel: String(cfg.vlmModel || ''),
      }
    },
    setConfigData(data, { Result }) {
      try {
        writeUserConfig(data || {})
        return Result.ok({}, '保存成功，面板「AI生成文案」即刻可用')
      } catch (err) {
        return Result.error(`保存失败：${err.message || err}`)
      }
    },
  },
})
