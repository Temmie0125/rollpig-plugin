import plugin from '../../lib/plugins/plugin.js'
import path from 'path'
import { fileURLToPath } from 'url'
import { readConfig } from './lib/app-config.js'
import { listOfficialPigs } from './lib/custom-store.js'
import { ensureState, mutateState, pruneState } from './lib/state.js'
import { cronForShanghai, everyMinutesForShanghaiHours } from './lib/time.js'
import * as daily from './lib/commands/daily.js'
import * as help from './lib/commands/help.js'
import * as pighub from './lib/commands/pighub.js'
import * as roast from './lib/commands/roast.js'
import * as report from './lib/commands/report.js'
import { refreshPigHub } from './lib/commands/pighub.js'
import { runDailyReportJob, runDailyReportRecovery } from './lib/report/job.js'
import { deliverReadyReservations, deliverWaitingNotices } from './lib/roast/delivery.js'
import { resetStaleReservations } from './lib/roast/reservations.js'
import { expireRefills } from './lib/roast/refill.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export class RollPigPlugin extends plugin {
  constructor() {
    super({
      name: '今天是什么小猪',
      dsc: '抽取专属小猪、EX 成长、烤猪与猪圈日报',
      event: 'message',
      priority: 5000,
      rule: [
        {
          reg: '^#?(猪猪帮助|小猪帮助|rollpig帮助|pig帮助)\\s*$',
          fnc: 'help'
        },
        {
          reg: '^#?(今日小猪|今天是什么小猪|本日小猪|当日小猪|今日猪猪|猪来)$',
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
          reg: '^#?(猪圈|猪猪图鉴|我的猪圈|我的小猪)\\s*$',
          fnc: 'pigPen'
        },
        {
          reg: '^#?明日小猪$',
          fnc: 'tomorrowPig'
        },
        {
          reg: '^#?昨日小猪$',
          fnc: 'yesterdayPig'
        },
        {
          reg: '^#?今日烤猪$',
          fnc: 'todayRoast'
        },
        {
          reg: '^#?(烤群友|加急生火|强行点火)(\\s|$)',
          fnc: 'memberRoast'
        },
        {
          reg: '^#?(随机烤群友|随机烤猪|抽个群友烤了)$',
          fnc: 'randomRoast'
        },
        {
          reg: '^#(加入|加入预约|加入烤猪)$',
          fnc: 'joinReservation'
        },
        {
          reg: '^#?(烤箱续火|烤箱补货|重置烤猪次数|恢复烧烤配额|申请烤箱补给|重置烧烤次数)$',
          fnc: 'refill'
        },
        {
          reg: '^#(续火|投票|支持)$',
          fnc: 'voteRefill'
        },
        {
          reg: '^#?猪圈日报$',
          fnc: 'reportQuery'
        },
        {
          reg: '^#?(小猪日报|每日总结设置|rollpig日报)(\\s|$)',
          fnc: 'reportSwitch'
        },
        {
          reg: '^#?猪猪设置\\s*markdown\\s*(开启|关闭|on|off)\\s*$',
          fnc: 'setMarkdown',
          permission: 'master'
        }
      ]
    })

    this.root = __dirname
    this.pigData = listOfficialPigs()
    this.config = readConfig()
    ensureState()

    // OneBotv11 适配器目前只记录 group_msg_emoji_like，不向插件派发；
    // 这里仍注册 handler，Milky/未来适配器可用时自动生效，回复投票是兜底。
    this.handler = {
      key: 'notice.group.msg_emoji_like',
      fn: 'onReaction',
      priority: 5000
    }

    this.task = [
      {
        name: 'PigHub数据刷新',
        cron: '0 0 * * *',
        fnc: () => refreshPigHub()
      },
      {
        name: '猪圈日报推送',
        cron: cronForShanghai(23, 45),
        fnc: () => runDailyReportJob()
      },
      {
        name: '猪圈日报恢复',
        cron: everyMinutesForShanghaiHours([23, 0], 5),
        fnc: () => runDailyReportRecovery()
      },
      {
        name: '烤猪预约与续火轮询',
        cron: '* * * * *',
        fnc: () => this.pollRuntime()
      },
      {
        name: '小猪数据清理',
        cron: cronForShanghai(3, 30),
        fnc: () => this.cleanupData()
      }
    ]
  }

  async pollRuntime() {
    try {
      await resetStaleReservations()
      await expireRefills()
      await deliverReadyReservations({})
      await deliverWaitingNotices({})
    } catch (error) {
      ;(globalThis.logger || console).warn?.('[今天是什么小猪] 轮询失败:', error)
    }
  }

  async cleanupData() {
    try {
      await pruneState()
    } catch (error) {
      ;(globalThis.logger || console).warn?.('[今天是什么小猪] 数据清理失败:', error)
    }
  }

  help(e) {
    return help.showHelp(e)
  }

  todayPig(e) {
    return daily.todayPig(this, e)
  }

  tomorrowPig(e) {
    return daily.tomorrowPig(e)
  }

  yesterdayPig(e) {
    return daily.yesterdayPig(this, e)
  }

  pigPen(e) {
    return daily.pigPen(this, e)
  }

  setMarkdown(e) {
    return daily.setMarkdown(this, e)
  }

  randomPig(e) {
    return pighub.randomPig(e)
  }

  findPig(e) {
    return pighub.findPig(e)
  }

  todayRoast(e) {
    return roast.todayRoast(this, e)
  }

  memberRoast(e) {
    return roast.memberRoast(this, e)
  }

  randomRoast(e) {
    return roast.randomRoast(this, e)
  }

  joinReservation(e) {
    return roast.joinReservation(this, e)
  }

  refill(e) {
    return roast.refill(this, e)
  }

  voteRefill(e) {
    return roast.voteRefillReply(this, e)
  }

  onReaction(e) {
    return roast.onReaction(e)
  }

  reportQuery(e) {
    return report.reportQuery(this, e)
  }

  reportSwitch(e) {
    return report.reportSwitch(this, e)
  }
}
