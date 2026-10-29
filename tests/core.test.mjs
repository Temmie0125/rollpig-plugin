import test from 'node:test'
import assert from 'node:assert/strict'
import { addDays, dateParts, latestReportQueryDate, reportCutoffIso, todayStr } from '../lib/time.js'
import { expertLevel, resolveAppearance } from '../lib/pigs.js'
import { listOfficialPigs } from '../lib/custom-store.js'
import { countRoastedUsers } from '../lib/roast/events.js'
import {
  legacyRoastState,
  nextChargeSeconds,
  normalizeChargeSettings,
  recoverRoastCharges
} from '../lib/roast/charges.js'
import { migrateLegacyRecords } from '../lib/state.js'
import { buildDailyReport, selectTimeline } from '../lib/report/build.js'

test('上海日期与昨日/截止点', () => {
  assert.equal(todayStr(0).length, 10)
  assert.equal(addDays('2026-03-01', -1), '2026-02-28')
  assert.deepEqual(dateParts('2026-10-29').weekdayCn, '星期四')
  assert.equal(latestReportQueryDate(Date.parse('2026-10-29T10:00:00+08:00')), '2026-10-28')
  assert.equal(latestReportQueryDate(Date.parse('2026-10-29T23:50:00+08:00')), null)
  assert.equal(latestReportQueryDate(Date.parse('2026-10-30T00:05:00+08:00')), null)
  assert.equal(latestReportQueryDate(Date.parse('2026-10-30T00:20:00+08:00')), '2026-10-29')
  assert.equal(reportCutoffIso('2026-10-29'), '2026-10-29T23:45:00+08:00')
})

test('EX 等级与差分解析', () => {
  assert.equal(expertLevel(1, 0), 0)
  assert.equal(expertLevel(3, 0), 2)
  assert.equal(expertLevel(9, 0), 5)
  assert.equal(expertLevel(1, 5), 5)
  const pig = listOfficialPigs().find(item => item.id === 'coder-pig')
  assert.ok(pig)
  const base = resolveAppearance(pig, 0)
  const ex2 = resolveAppearance(pig, 2)
  const ex5 = resolveAppearance(pig, 5)
  assert.equal(base.appliedLevel, 0)
  assert.match(ex2.imagePath, /coder-pig_ex2\.png$/)
  assert.notEqual(ex2.pig.description, base.pig.description)
  assert.equal(ex5.appliedLevel, 5)
  assert.equal(ex5.pig.description, '赛博承重墙')
})

test('充能桶恢复逻辑', () => {
  const settings = normalizeChargeSettings({ cooldownSeconds: 60, maxCharges: 2 })
  assert.deepEqual(settings, { cooldown: 60, chargeMax: 2 })
  assert.deepEqual(legacyRoastState(0, 1000, 60, 2), { charges: 2, updated: 1000 })
  assert.deepEqual(recoverRoastCharges(0, 1000, 1120, 60, 2), { charges: 2, updated: 1120 })
  assert.equal(nextChargeSeconds(0, 1000, 1030, 60, 2), 30)
})

test('被烤次数统计与特殊惩罚限次', () => {
  const events = [
    { date: '2026-10-29', event_id: '1', type: 'success', attacker: 'a', target: 'b', group_id: 'g' },
    { date: '2026-10-29', event_id: '2', type: 'success', attacker: 'c', target: 'b', group_id: 'g' },
    { date: '2026-10-29', event_id: '3', type: 'bot_backfire', attacker: 'a', group_id: 'g' },
    { date: '2026-10-29', event_id: '4', type: 'bot_backfire', attacker: 'a', group_id: 'g' },
    { date: '2026-10-29', event_id: '5', type: 'backfire', attacker: 'a', group_id: 'g', special_reason: 'unrolled' },
    { date: '2026-10-29', event_id: '6', type: 'backfire', attacker: 'a', group_id: 'g', special_reason: 'unrolled' }
  ]
  const counts = countRoastedUsers(events)
  assert.equal(counts.get('b'), 2)
  assert.equal(counts.get('a'), 2) // bot 1 次 + unrolled 1 次
})

test('旧 records.json 迁移', () => {
  const state = migrateLegacyRecords({
    '1001': {
      date: '2026/10/28',
      pig_id: 'pig',
      pigs: { pig: 2, human: 1 },
      total: 3
    }
  })
  assert.deepEqual(state.collection['1001'], ['pig', 'human'])
  assert.equal(state.pig_progress['1001'].pig.copies, 2)
  assert.equal(state.history['2026-10-28']['1001'], 'pig')
  assert.equal(state.snapshots['2026-10-28']['1001'].previous_level, 0)
  assert.equal(state.snapshots['2026-10-28']['1001'].level, 1)
})

test('日报指标/见闻/头条/事件追踪', () => {
  const now = '2026-10-29T12:00:00.000Z'
  const make = (type, attacker, target, extra = {}) => ({
    event_id: `${type}-${attacker}-${target}-${Math.random()}`,
    date: '2026-10-29',
    created_at: now,
    type,
    attacker,
    target,
    attacker_name: `甲${attacker}`,
    target_name: `乙${target}`,
    group_id: 'g',
    ...extra
  })
  const events = [
    make('success', 'a', 'b', {
      food: '培根', reservation_id: 'r1', participant_ids: ['a', 'c', 'd'],
      participant_names: ['甲a', '甲c', '甲d'], participant_count: 3, protection_level: 3
    }),
    make('escape', 'b', 'a'),
    make('success', 'b', 'a', { food: '叉烧' }),
    make('success', 'd', 'a', {
      food: '烤猪', reservation_id: 'r2', participant_ids: ['d', 'a'],
      participant_names: ['甲d', '甲a'], participant_count: 2
    }),
    make('backfire', 'c', 'd', { backfire_victim_id: 'c' })
  ]
  const report = buildDailyReport({
    date: '2026-10-29',
    groupId: 'g',
    groupRolls: { a: 'pig', b: 'human', c: 'bacon', d: 'ghost-pig' },
    rawEvents: events,
    activeUserIds: ['a', 'b', 'c', 'd'],
    botUserIds: [],
    profiles: {},
    humanPigIds: ['human'],
    cutoffIso: '2026-10-29T23:45:00+08:00'
  })
  assert.equal(report.overview.roll_count, 4)
  assert.equal(report.overview.reservation_count, 2)
  assert.equal(report.overview.backfire_count, 1)
  assert.ok(report.observation)
  assert.ok(report.headline)
  assert.ok(selectTimeline(report.events, report.headline))
})
