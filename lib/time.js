// 业务时间固定按 Asia/Shanghai（UTC+8）计算，不依赖宿主机时区。
// Linux 服务器常用 UTC，直接用 new Date().toLocaleDateString() 会把每日重置点推到早上 8 点。
const OFFSET_MS = 8 * 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000
const WEEKDAYS = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六']

/** 返回一个“UTC 字段就是上海墙上时间”的 Date，仅用于取年月日时分 */
export const shanghaiDate = (timestamp = Date.now()) => new Date(timestamp + OFFSET_MS)

export const nowIso = () => new Date().toISOString()

export const dateStrFrom = date => {
  const d = new Date(date.getTime())
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
}

export const todayStr = (offsetDays = 0, timestamp = Date.now()) => {
  const d = shanghaiDate(timestamp)
  d.setUTCDate(d.getUTCDate() + Number(offsetDays || 0))
  return dateStrFrom(d)
}

export const yesterdayStr = timestamp => todayStr(-1, timestamp)
export const tomorrowStr = timestamp => todayStr(1, timestamp)

export const dateParts = dateStr => {
  const match = String(dateStr || '').match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const utc = new Date(Date.UTC(year, month - 1, day))
  if (utc.getUTCFullYear() !== year || utc.getUTCMonth() + 1 !== month || utc.getUTCDate() !== day) return null
  return { year, month, day, weekday: utc.getUTCDay(), weekdayCn: WEEKDAYS[utc.getUTCDay()] }
}

export const addDays = (dateStr, days) => {
  const parts = dateParts(dateStr)
  if (!parts) return ''
  const utc = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + Number(days || 0)))
  return dateStrFrom(utc)
}

export const daysBetween = (fromDate, toDate) => {
  const a = dateParts(fromDate)
  const b = dateParts(toDate)
  if (!a || !b) return 0
  const from = Date.UTC(a.year, a.month - 1, a.day)
  const to = Date.UTC(b.year, b.month - 1, b.day)
  return Math.round((to - from) / DAY_MS)
}

export const shanghaiClock = (timestamp = Date.now()) => {
  const d = shanghaiDate(timestamp)
  return {
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
    second: d.getUTCSeconds(),
    minutes: d.getUTCHours() * 60 + d.getUTCMinutes()
  }
}

export const reportCutoffIso = dateStr => `${dateStr}T23:45:00+08:00`
export const reportCutoffSeconds = () => 23 * 60 + 45
export const reportRetryCutoffSeconds = () => 10

/** 主动查卡：23:45-00:09 正在出刊，返回 null；其余时间返回昨天 */
export const latestReportQueryDate = (timestamp = Date.now()) => {
  const { minutes } = shanghaiClock(timestamp)
  if (minutes >= 23 * 60 + 45 || minutes < 10) return null
  return todayStr(-1, timestamp)
}

/** 启动恢复只在 23:45-00:10 窗口内运行，返回需要补跑的日报日期 */
export const dailyReportRecoveryDate = (timestamp = Date.now()) => {
  const { minutes } = shanghaiClock(timestamp)
  if (minutes >= 23 * 60 + 45) return todayStr(0, timestamp)
  if (minutes < 10) return todayStr(-1, timestamp)
  return null
}

/**
 * 把“上海时间 hour:minute”换算成宿主本地 cron。
 * node-schedule 使用进程本地时区；Linux 常见 UTC，直接写 45 23 会早 8 小时。
 */
export const cronForShanghai = (hour, minute) => {
  const localOffset = -new Date().getTimezoneOffset() // 东八区为 480
  let total = Number(hour) * 60 + Number(minute) + (localOffset - 480)
  total = ((total % 1440) + 1440) % 1440
  return `${total % 60} ${Math.floor(total / 60)} * * *`
}

/** 与 cronForShanghai 相同，但把小时换成“每 N 分钟”的分钟位，用于日报恢复窗口 */
export const everyMinutesForShanghaiHours = (hours, step = 5) => {
  const localOffset = -new Date().getTimezoneOffset()
  const localHours = [...new Set((hours || []).map(hour => {
    const total = ((Number(hour) * 60 + (localOffset - 480)) % 1440 + 1440) % 1440
    return Math.floor(total / 60)
  }))].sort((a, b) => a - b)
  return `*/${step} ${localHours.join(',')} * * *`
}
