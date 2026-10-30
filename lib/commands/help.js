// #猪猪帮助：用现有图鉴风格渲染插件使用说明长图，渲染失败时回退纯文本。
import fs from 'fs'
import path from 'path'
import { PLUGIN_ROOT, assetUrl, buildFontCss, helpTemplate, renderSegment, uniqueSaveId } from '../render.js'

let PLUGIN_VERSION = ''
try {
  PLUGIN_VERSION = String(JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT, 'package.json'), 'utf8')).version || '')
} catch {}

export const buildHelpSections = () => [
  {
    icon: '🐷',
    title: '每日抽猪',
    items: [
      { cmd: '#今日小猪', desc: '抽取今日专属小猪，每天一次；重复抽到会累积 EX Lv.0-5', alias: '今天是什么小猪 / 本日小猪 / 猪来' },
      { cmd: '#昨日小猪', desc: '查看昨日回顾卡；昨天漏抽会自动免费补签' },
      { cmd: '#明日小猪', desc: '随机预测一下明天的小猪' }
    ]
  },
  {
    icon: '📖',
    title: '猪猪图鉴',
    items: [
      { cmd: '#猪圈', desc: '查看个人收集图鉴长图，支持 @某人 代查', alias: '猪猪图鉴 / 我的猪圈 / 我的小猪' },
      { cmd: '#随机小猪 [1-20]', desc: '从 PigHub 随机欣赏几张猪猪图' },
      { cmd: '#找猪 关键词', desc: '在 PigHub 搜索猪猪图片', alias: '搜猪' }
    ]
  },
  {
    icon: '🔥',
    title: '烤猪玩法',
    items: [
      { cmd: '#今日烤猪', desc: '把自己的今日小猪做成一道料理' },
      { cmd: '#烤群友 @目标', desc: '普通烤群友：60% 成功 / 30% 逃脱 / 10% 反噬；也可回复目标消息发送' },
      { cmd: '#加急生火 @目标', desc: '每日一次：普通目标必中，保护目标贡献 2 点火力' },
      { cmd: '#强行点火 @目标', desc: '无视保护直接接管预约开烤', tag: '主人' },
      { cmd: '#随机烤群友', desc: '从本群今日已抽猪的成员中随机开烤', alias: '随机烤猪 / 抽个群友烤了' }
    ]
  },
  {
    icon: '🗳️',
    title: '预约与续火',
    items: [
      { cmd: '#加入', desc: '回复预约通知发送，加入聚众烤猪（最多 12 人）', alias: '加入预约 / 加入烤猪' },
      { cmd: '#烤箱续火', desc: '发起 10 分钟续火投票，成功后回满本群活跃玩家的烤猪次数', alias: '烤箱补货 / 重置烤猪次数' },
      { cmd: '#续火', desc: '回复续火投票消息发送，为投票计一票', alias: '投票 / 支持' }
    ]
  },
  {
    icon: '📰',
    title: '猪圈日报',
    items: [
      { cmd: '#猪圈日报', desc: '查看本群最近一期封版日报长图' },
      { cmd: '#小猪日报 开启/关闭', desc: '控制本群每天 23:45 的日报推送；主人可带群号远程设置', tag: '管理员', alias: '每日总结设置 / rollpig日报' },
      { cmd: '#猪猪设置markdown 开启/关闭', desc: '切换官方 QQBot 的 Markdown 回复格式', tag: '主人' }
    ]
  }
]

export const buildHelpText = () => [
  '【今天是什么小猪】帮助菜单',
  ...buildHelpSections().map(section => [
    `■ ${section.title}`,
    ...section.items.map(item => {
      const tag = item.tag ? `［${item.tag}］` : ''
      const alias = item.alias ? `（也可发送：${item.alias}）` : ''
      return `${item.cmd}${tag} ${item.desc}${alias}`
    })
  ].join('\n')),
  `发送 #猪猪帮助 随时查看${PLUGIN_VERSION ? ` · v${PLUGIN_VERSION}` : ''}`
].join('\n\n')

export const showHelp = async (e) => {
  try {
    const image = await renderSegment({
      name: 'rollpig-help',
      tplFile: helpTemplate,
      saveId: uniqueSaveId('rollpig-help'),
      data: {
        fontCss: buildFontCss(),
        pigImage: assetUrl('image', 'pig.png'),
        version: PLUGIN_VERSION || '2.0',
        sections: buildHelpSections()
      }
    })
    await e.reply(image)
  } catch (error) {
    ;(globalThis.logger || console).error?.('[今天是什么小猪] 帮助图渲染失败:', error)
    await e.reply(buildHelpText())
  }
  return true
}
