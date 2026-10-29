// 锅巴（Guoba）配置页：Markdown、VLM、AI 烤猪、烤猪充能、日报默认开关。
// 配置键保持顶层扁平（嵌套 key 会导致锅巴保存报错），读写统一走 lib/app-config.js。
import { DEFAULT_CONFIG, readConfig, saveConfig } from './lib/app-config.js'

export const supportGuoba = () => ({
  pluginInfo: {
    name: 'rollpig-plugin',
    title: '今天是什么小猪',
    description: '每日抽取专属小猪、EX 成长、烤猪、猪圈日报与自定义图鉴管理',
    author: '@Temmie0125',
    authorLink: 'https://github.com/Temmie0125',
    link: 'https://github.com/Temmie0125/rollpig-plugin',
    isV3: true,
    isV2: false,
    showInMenu: 'auto'
  },
  configInfo: {
    schemas: [
      {
        field: 'markdown',
        label: 'Markdown 回复',
        helpMessage: '官方QQBot使用Markdown格式回复（@用户 + 引用块 + 按钮），其他平台自动回退；也可用命令 #猪猪设置markdown开启/关闭',
        component: 'Switch'
      },
      {
        component: 'SOFT_GROUP_BEGIN',
        label: 'AI 文案生成（VLM）',
        helpMessage: '供管理面板「猪猪图鉴管理」的 AI 生成文案使用；协议为 OpenAI 兼容 chat/completions，三项全部填写后生效'
      },
      {
        field: 'vlmApiUrl',
        label: 'API 地址',
        helpMessage: 'OpenAI 兼容接口地址，如 https://api.example.com/v1',
        component: 'Input'
      },
      {
        field: 'vlmApiKey',
        label: 'API Key',
        component: 'InputPassword'
      },
      {
        field: 'vlmModel',
        label: '视觉模型 / AI 烤猪模型',
        helpMessage: '面板文案需要支持图片输入的模型；AI 烤猪为纯文本调用，也复用这个模型名',
        component: 'Input'
      },
      {
        component: 'SOFT_GROUP_BEGIN',
        label: 'AI 烤猪',
        helpMessage: '复用上方 VLM 配置；关闭后只影响烤猪文案生成，管理面板 AI 生成文案仍可正常使用'
      },
      {
        field: 'aiRoastEnabled',
        label: '启用 AI 烤猪',
        helpMessage: '开启后，AI 文案库为空或不足时会尝试生成；失败自动回退本地文案池',
        component: 'Switch'
      },
      {
        component: 'SOFT_GROUP_BEGIN',
        label: '烤猪与日报'
      },
      {
        field: 'roastCooldownHours',
        label: '普通烤猪恢复小时',
        helpMessage: '每多少小时恢复 1 次普通烤群友充能，默认 8；最小 1 分钟',
        component: 'Input'
      },
      {
        field: 'roastChargeMax',
        label: '普通烤猪最大充能',
        helpMessage: '1-6，默认 2',
        component: 'Input'
      },
      {
        field: 'dailyReportDefault',
        label: '日报全局默认开启',
        helpMessage: '默认关闭；开启后所有活跃群默认推送，单群仍可用「小猪日报 开启/关闭」覆盖',
        component: 'Switch'
      }
    ],
    getConfigData() {
      const cfg = readConfig()
      return {
        markdown: cfg.markdown,
        vlmApiUrl: cfg.vlmApiUrl,
        vlmApiKey: cfg.vlmApiKey,
        vlmModel: cfg.vlmModel,
        aiRoastEnabled: cfg.aiRoastEnabled,
        roastCooldownHours: cfg.roastCooldownHours,
        roastChargeMax: cfg.roastChargeMax,
        dailyReportDefault: cfg.dailyReportDefault
      }
    },
    setConfigData(data, { Result }) {
      try {
        saveConfig({ ...readConfig(), ...(data || {}) })
        return Result.ok({}, '保存成功，AI 烤猪与面板 AI 文案即刻可用')
      } catch (error) {
        return Result.error(`保存失败：${error.message || error}`)
      }
    }
  }
})

export { DEFAULT_CONFIG }
