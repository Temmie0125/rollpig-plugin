// 单文件状态存储。TRSS loader 每条消息都会重新实例化插件类，所以状态和互斥队列必须放在模块级，
// 不能挂在 this 上；所有写操作串行化并原子替换，避免并发命令互相覆盖。
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { daysBetween, nowIso, todayStr } from './time.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const PLUGIN_ROOT = path.resolve(__dirname, '..')
// 测试脚本通过 ROLLPIG_DATA_DIR 指向临时目录，绝不能误删生产 data/。
export const DATA_DIR = process.env.ROLLPIG_DATA_DIR
  ? path.resolve(process.env.ROLLPIG_DATA_DIR)
  : path.join(PLUGIN_ROOT, 'data')
export const STATE_PATH = path.join(DATA_DIR, 'state.json')
export const LEGACY_RECORDS_PATH = path.join(DATA_DIR, 'records.json')
const BACKUP_PATH = STATE_PATH + '.bak'

const log = () => globalThis.logger || console

export const createEmptyState = () => ({
  version: 1,
  history: {},
  snapshots: {},
  group_rolls: {},
  group_active: {},
  collection: {},
  pig_progress: {},
  draw_state: {},
  daily_feeds: {},
  usage: {},
  force_usage: {},
  events: {},
  protected: {},
  protection_details: {},
  unrolled_attempts: {},
  reservations: {},
  refills: {},
  report_groups: {},
  report_deliveries: {},
  settlements: {},
  user_names: {}
})

const OBJECT_KEYS = [
  'history', 'snapshots', 'group_rolls', 'group_active', 'collection', 'pig_progress',
  'draw_state', 'daily_feeds', 'usage', 'force_usage', 'events', 'protected',
  'protection_details', 'unrolled_attempts', 'reservations', 'refills', 'report_groups',
  'report_deliveries', 'settlements', 'user_names'
]

export const normalizeState = raw => {
  const state = createEmptyState()
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return state
  for (const key of OBJECT_KEYS) {
    if (raw[key] && typeof raw[key] === 'object' && !Array.isArray(raw[key])) state[key] = raw[key]
  }
  state.version = Number(raw.version) || 1
  return state
}

const normalizeDateKey = value => {
  const text = String(value || '').trim()
  let match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
  if (!match) match = text.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/)
  if (!match) return ''
  const year = match[1]
  const month = String(Number(match[2])).padStart(2, '0')
  const day = String(Number(match[3])).padStart(2, '0')
  const result = `${year}-${month}-${day}`
  return result
}

/** 旧 records.json：{uid:{date,pig_id,pigs:{id:count},total}} → 新状态 */
export const migrateLegacyRecords = (records, source = 'legacy') => {
  const state = createEmptyState()
  if (!records || typeof records !== 'object') return state
  let users = 0
  for (const [rawUserId, record] of Object.entries(records)) {
    if (!record || typeof record !== 'object') continue
    const userId = String(rawUserId)
    const pigs = record.pigs && typeof record.pigs === 'object' ? record.pigs : (record.pig_id ? { [record.pig_id]: 1 } : {})
    const collection = []
    const progress = {}
    for (const [pigId, rawCount] of Object.entries(pigs)) {
      const count = Math.max(0, Math.trunc(Number(rawCount) || 0))
      if (!pigId || count <= 0) continue
      collection.push(pigId)
      progress[pigId] = { copies: count, growth_bonus: 0, first_obtained_at: null }
    }
    state.collection[userId] = collection
    state.pig_progress[userId] = progress
    state.draw_state[userId] = { duplicate_streak: 0 }
    users++

    const date = normalizeDateKey(record.date)
    const pigId = String(record.pig_id || '')
    if (!date || !pigId || !progress[pigId]) continue
    state.history[date] ||= {}
    state.history[date][userId] = pigId
    const copies = progress[pigId].copies
    const previousCopies = copies > 1 ? copies - 1 : 0
    state.snapshots[date] ||= {}
    state.snapshots[date][userId] = {
      pig_id: pigId,
      is_new_pig: copies <= 1,
      previous_copies: previousCopies,
      copies,
      previous_level: Math.min(5, Math.max(0, previousCopies - 1)),
      level: Math.min(5, Math.max(0, copies - 1)),
      collection_size: collection.length,
      is_makeup: false,
      source,
      created_at: null
    }
  }
  return state
}

const readJson = file => {
  const text = fs.readFileSync(file, 'utf8')
  return JSON.parse(text)
}

const loadSync = () => {
  if (fs.existsSync(STATE_PATH)) {
    try {
      return normalizeState(readJson(STATE_PATH))
    } catch (error) {
      const broken = `${STATE_PATH}.broken-${Date.now()}`
      try { fs.copyFileSync(STATE_PATH, broken) } catch {}
      log().error?.(`[今天是什么小猪] state.json 损坏，已保留 ${broken}:`, error)
    }
  }
  if (fs.existsSync(BACKUP_PATH)) {
    try {
      const state = normalizeState(readJson(BACKUP_PATH))
      log().warn?.('[今天是什么小猪] 已从 state.json.bak 恢复状态')
      return state
    } catch (error) {
      log().error?.('[今天是什么小猪] state.json.bak 也无法读取:', error)
    }
  }
  if (fs.existsSync(LEGACY_RECORDS_PATH)) {
    try {
      const state = migrateLegacyRecords(readJson(LEGACY_RECORDS_PATH))
      const users = Object.keys(state.collection).length
      log().info?.(`[今天是什么小猪] 已从 records.json 迁移 ${users} 位用户到 state.json（旧文件保留）`)
      return state
    } catch (error) {
      log().error?.('[今天是什么小猪] records.json 迁移失败:', error)
    }
  }
  return createEmptyState()
}

let state = null
let queue = Promise.resolve()
let lastBackupAt = 0

export const ensureState = () => {
  if (!state) state = loadSync()
  return state
}

export const getState = () => ensureState()

/** 读取前等待挂起的写操作，保证同一事件内读到的是一致的快照 */
export const readStateSynced = async fn => {
  await queue.catch(() => {})
  const current = ensureState()
  return fn ? fn(current) : current
}

const writeSync = () => {
  fs.mkdirSync(DATA_DIR, { recursive: true })
  const temporary = STATE_PATH + '.tmp'
  fs.writeFileSync(temporary, JSON.stringify(state, null, 2), 'utf8')
  if (fs.existsSync(STATE_PATH) && Date.now() - lastBackupAt > 60 * 60 * 1000) {
    try { fs.copyFileSync(STATE_PATH, BACKUP_PATH) } catch {}
    lastBackupAt = Date.now()
  }
  try {
    fs.renameSync(temporary, STATE_PATH)
  } catch (error) {
    // Windows 开发环境下目标文件偶尔被 AV/编辑器短暂占用；Linux 的原子 rename 不受影响。
    if (!['EPERM', 'EEXIST', 'EACCES'].includes(error?.code)) throw error
    fs.copyFileSync(temporary, STATE_PATH)
    try { fs.unlinkSync(temporary) } catch {}
  }
}

/** 串行执行一次状态修改，成功后立即原子落盘；失败不吞掉，交给命令层提示用户 */
export const mutateState = fn => {
  const task = queue.then(async () => {
    const current = ensureState()
    const result = await fn(current)
    writeSync()
    return result
  })
  queue = task.catch(() => {})
  return task
}

export const touchUser = (userId, name) => {
  const normalized = String(userId || '')
  if (!normalized) return
  const stateRef = ensureState()
  const display = String(name || '').trim()
  if (display) stateRef.user_names[normalized] = display
}

const pruneInState = (current, nowDate) => {
  const removed = {}
  const pruneMap = (key, days) => {
    let count = 0
    for (const date of Object.keys(current[key] || {})) {
      if (daysBetween(date, nowDate) > days) {
        delete current[key][date]
        count++
      }
    }
    if (count) removed[key] = count
  }
  pruneMap('history', 14)
  pruneMap('snapshots', 14)
  pruneMap('group_rolls', 14)
  pruneMap('group_active', 14)
  pruneMap('daily_feeds', 14)
  pruneMap('events', 7)
  pruneMap('protected', 14)
  pruneMap('protection_details', 14)
  pruneMap('unrolled_attempts', 7)
  pruneMap('report_deliveries', 14)
  pruneMap('refills', 7)
  pruneMap('settlements', 14)

  let reservations = 0
  for (const [id, reservation] of Object.entries(current.reservations || {})) {
    if (!reservation || typeof reservation !== 'object') {
      delete current.reservations[id]
      reservations++
      continue
    }
    const date = String(reservation.date_str || '')
    const age = date ? daysBetween(date, nowDate) : 0
    if (age > 14 || (age > 7 && !['pending', 'ready', 'processing'].includes(reservation.status))) {
      delete current.reservations[id]
      reservations++
    }
  }
  if (reservations) removed.reservations = reservations
  return removed
}

export const pruneState = (nowDate = todayStr()) => mutateState(state => pruneInState(state, nowDate))

export const stateSummary = () => {
  const current = ensureState()
  return {
    users: Object.keys(current.collection).length,
    historyDays: Object.keys(current.history).length,
    eventDays: Object.keys(current.events).length,
    reservations: Object.keys(current.reservations).length,
    updatedAt: nowIso()
  }
}
