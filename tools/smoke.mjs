// 本地烟雾测试：不连 QQ，只验证抽猪、预约、保护、加餐、日报装配。
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PLUGIN_ROOT = path.resolve(__dirname, '..')
const SMOKE_DATA = path.join(PLUGIN_ROOT, '.smoke-data')
process.env.ROLLPIG_DATA_DIR = SMOKE_DATA
process.chdir(path.resolve(PLUGIN_ROOT, '../..'))
globalThis.logger = new Proxy(console, {
  get(target, prop) {
    if (prop in target) return target[prop]
    return (...args) => console.log(...args)
  }
})
fs.rmSync(SMOKE_DATA, { recursive: true, force: true })

const { listOfficialPigs } = await import('../lib/custom-store.js')
const daily = await import('../lib/daily.js')
const pigs = await import('../lib/pigs.js')
const reservations = await import('../lib/roast/reservations.js')
const protection = await import('../lib/roast/protection.js')
const charges = await import('../lib/roast/charges.js')
const events = await import('../lib/roast/events.js')
const { getState } = await import('../lib/state.js')
const { loadGroupReport } = await import('../lib/report/load.js')
const { buildDailyReport } = await import('../lib/report/build.js')

const official = listOfficialPigs()
const date = '2026-10-29'
const group = '2001'

const attackerDraw = await daily.getOrCreateDailyRoll({
  userId: '1001', officialPigs: official, date, groupId: group
})
const targetDraw = await daily.getOrCreateDailyRoll({
  userId: '1002', officialPigs: official, date, groupId: group, pigId: 'pig'
})
const repeat = await daily.getOrCreateDailyRoll({
  userId: '1001', officialPigs: official, date, groupId: group
})
console.log('draw', attackerDraw.created, targetDraw.pig_id, repeat.created, repeat.pig_id === attackerDraw.pig_id)
console.log('progress', daily.getProgressEntry('1001', attackerDraw.pig_id))
console.log('growth', daily.buildGrowthText({
  pig: pigs.getPigById(official, attackerDraw.pig_id),
  snapshot: attackerDraw.snapshot,
  pigId: attackerDraw.pig_id
}))

const attackerPig = pigs.getPigById(official, attackerDraw.pig_id)
const targetPig = pigs.getPigById(official, targetDraw.pig_id)

// 即时烤：目标已抽猪且未保护
const prep = await reservations.prepareRoastReservation({
  attackerId: '1001',
  attackerName: '甲',
  attackerPigId: attackerDraw.pig_id,
  targetId: '1002',
  targetName: '乙',
  groupId: group,
  forceMode: null
})
console.log('prepare immediate', prep.status)
const charge = await charges.consumeRoastCharge('1001', { config: { roastChargeMax: 2, roastCooldownHours: 8 } })
console.log('charge', charge.allowed, charge.charges_left)
const outcome = await (await import('../lib/roast/flow.js')).buildMemberRoastOutcome({
  attackerPig, targetPig, attackerName: '甲', targetName: '乙', officialPigs: official
})
console.log('outcome', outcome.type, outcome.foodName)
await events.appendRoastEvent({
  date, type: outcome.type, attacker: '1001', target: '1002', attacker_name: '甲', target_name: '乙',
  food: outcome.foodName, group_id: group, backfire_victim_id: outcome.backfireVictimId || '',
  backfire_victim_ids: outcome.backfireVictimIds || [], special_reason: outcome.specialReason || ''
})

// 保护：今天保护 1002，Lv.3 -> 需要 4 点火力
await (await import('../lib/state.js')).mutateState(state => {
  state.protected[date] ||= {}
  state.protected[date][group] = ['1002']
  state.protection_details[date] ||= {}
  state.protection_details[date][group] ||= {}
  state.protection_details[date][group]['1002'] = { base_level: 3, consecutive_days: 1, success_offset: 0, source: 'daily' }
})
const prepProtected = await reservations.prepareRoastReservation({
  attackerId: '1001', attackerName: '甲', attackerPigId: attackerDraw.pig_id,
  targetId: '1002', targetName: '乙', groupId: group, forceMode: null
})
console.log('prepare protected', prepProtected.status, prepProtected.reservation?.status, prepProtected.reservation?.protection_required, prepProtected.reservation?.contribution_count)
const join = await reservations.prepareRoastReservation({
  attackerId: '1003', attackerName: '丙', attackerPigId: targetDraw.pig_id,
  targetId: '1002', targetName: '乙', groupId: group, forceMode: 'normal'
})
console.log('join protected', join.status, join.reservation?.status, join.reservation?.contribution_count)

if (prepProtected.reservation) {
  const ready = await reservations.claimBuildableReservations({ groupId: group })
  console.log('claim buildable', ready.map(item => item.reservation_id))
  for (const item of ready) {
    const result = await reservations.buildReservationOutcome(item, official)
    const finalized = await reservations.finalizeReservation({ reservationId: item.reservation_id, outcome: result })
    console.log('finalized', result.type, finalized?.feedResults?.length, finalized?.protectionUpgrade)
  }
}

const report = await loadGroupReport({
  groupId: group, date, cutoffIso: `${date}T23:45:00+08:00`, officialPigs: official, botUserIds: ['bot']
})
console.log('report', report.report.has_activity, report.report.overview, report.report.rankings.length)

const { settleGroupProtection } = protection
const settled = await settleGroupProtection({
  date, groupId: group, cutoffIso: `${date}T23:45:00+08:00`,
  events: events.queryEvents({ date, groupId: group })
})
console.log('settle', settled.protected_ids, settled.protect_date)

fs.rmSync(SMOKE_DATA, { recursive: true, force: true })
console.log('SMOKE OK')
