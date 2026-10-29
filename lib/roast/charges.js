// 普通烤群友充能桶：满格 2 次，每 8 小时恢复 1 次（可在锅巴调整）。
// 逻辑与 plus 的 token bucket 一致；时间戳用 epoch 秒。
import { mutateState, getState } from '../state.js'
import { todayStr } from '../time.js'

export const normalizeChargeSettings = ({ cooldownSeconds, maxCharges, config = {} } = {}) => {
  const cooldown = Math.max(60, Math.trunc(Number(
    cooldownSeconds ?? (Number(config.roastCooldownHours ?? 8) * 3600)
  ) || 8 * 3600))
  const chargeMax = Math.max(1, Math.min(6, Math.trunc(Number(
    maxCharges ?? config.roastChargeMax ?? 2
  ) || 2)))
  return { cooldown, chargeMax }
}

/** 旧单时间戳 CD → 充能桶：最近一次使用后视为还剩 1 格 */
export const legacyRoastState = (lastUse, now, cooldown, maxCharges) => {
  if (!lastUse || lastUse <= 0) return { charges: maxCharges, updated: now }
  const elapsed = Math.max(0, now - lastUse)
  const recovered = Math.floor(elapsed / cooldown)
  const charges = Math.min(maxCharges, 1 + recovered)
  const updated = charges >= maxCharges ? now : lastUse + recovered * cooldown
  return { charges, updated }
}

export const recoverRoastCharges = (charges, updated, now, cooldown, maxCharges) => {
  let current = Math.max(0, Math.min(maxCharges, Math.trunc(Number(charges) || 0)))
  let anchor = Number(updated) || now
  if (current >= maxCharges) return { charges: maxCharges, updated: now }
  const elapsed = Math.max(0, now - anchor)
  const recovered = Math.floor(elapsed / cooldown)
  if (recovered <= 0) return { charges: current, updated: anchor }
  current = Math.min(maxCharges, current + recovered)
  anchor = current >= maxCharges ? now : anchor + recovered * cooldown
  return { charges: current, updated: anchor }
}

export const nextChargeSeconds = (charges, updated, now, cooldown, maxCharges) => {
  if (charges >= maxCharges) return 0
  const elapsed = Math.max(0, now - (Number(updated) || now))
  return Math.max(1, Math.trunc(cooldown - (elapsed % cooldown)))
}

export const formatCooldown = remainingSeconds => {
  const remaining = Math.max(0, Math.trunc(Number(remainingSeconds) || 0))
  const minutes = Math.floor(remaining / 60)
  const seconds = remaining % 60
  const hours = Math.floor(minutes / 60)
  const minutePart = minutes % 60
  const timeText = hours > 0 ? `${hours}小时${minutePart}分` : `${minutePart}分${seconds}秒`
  return `烧烤充能恢复中！还需要 ${timeText} 恢复 1 次。\n等不及了？发送「烤箱续火」，喊群友一起添把火。`
}

const readUsage = (state, userId) => {
  const raw = state.usage?.[String(userId)]
  if (raw && typeof raw === 'object') {
    return {
      last_roast_ts: Number(raw.last_roast_ts) || 0,
      roast_charges: Math.max(0, Math.trunc(Number(raw.roast_charges) || 0)),
      roast_charge_updated_ts: Number(raw.roast_charge_updated_ts) || 0
    }
  }
  return { legacy: Number(raw) || 0 }
}

/** 在已持有的 state 事务里扣一次普通充能 */
export const consumeChargeInState = (state, userId, now, cooldown, chargeMax) => {
  const uid = String(userId)
  state.usage ||= {}
  const raw = readUsage(state, uid)
  let charges
  let updated
  if (raw.legacy !== undefined) {
    ;({ charges, updated } = legacyRoastState(raw.legacy, now, cooldown, chargeMax))
  } else {
    charges = raw.roast_charges
    updated = raw.roast_charge_updated_ts || now
  }
  ;({ charges, updated } = recoverRoastCharges(charges, updated, now, cooldown, chargeMax))
  if (charges <= 0) {
    state.usage[uid] = {
      last_roast_ts: raw.legacy ? raw.legacy : raw.last_roast_ts,
      roast_charges: 0,
      roast_charge_updated_ts: updated
    }
    return {
      allowed: false,
      remaining_seconds: nextChargeSeconds(0, updated, now, cooldown, chargeMax),
      charges_left: 0,
      max_charges: chargeMax
    }
  }
  const wasFull = charges >= chargeMax
  charges -= 1
  if (wasFull) updated = now
  state.usage[uid] = {
    last_roast_ts: now,
    roast_charges: charges,
    roast_charge_updated_ts: updated
  }
  return {
    allowed: true,
    remaining_seconds: 0,
    charges_left: charges,
    max_charges: chargeMax,
    next_recover_seconds: nextChargeSeconds(charges, updated, now, cooldown, chargeMax)
  }
}

/** 原子扣一次普通充能；返回 allowed / 剩余秒数 / 剩余次数 */
export const consumeRoastCharge = async (userId, options = {}) => {
  const now = Number(options.now) || Date.now() / 1000
  const { cooldown, chargeMax } = normalizeChargeSettings(options)
  return mutateState(state => consumeChargeInState(state, userId, now, cooldown, chargeMax))
}

export const checkRoastCharge = (userId, config = {}) => {
  const now = Date.now() / 1000
  const { cooldown, chargeMax } = normalizeChargeSettings({ config })
  const raw = readUsage(getState(), userId)
  const { charges, updated } = raw.legacy !== undefined
    ? legacyRoastState(raw.legacy, now, cooldown, chargeMax)
    : recoverRoastCharges(raw.roast_charges, raw.roast_charge_updated_ts || now, now, cooldown, chargeMax)
  const recovered = recoverRoastCharges(charges, updated, now, cooldown, chargeMax)
  return {
    charges: recovered.charges,
    max_charges: chargeMax,
    remaining_seconds: nextChargeSeconds(recovered.charges, recovered.updated, now, cooldown, chargeMax)
  }
}

export const consumeForceInState = (state, userId, date = todayStr()) => {
  const uid = String(userId)
  state.force_usage ||= {}
  if (state.force_usage[uid] === date) return false
  state.force_usage[uid] = date
  return true
}

export const consumeForceUsage = async (userId, date = todayStr()) =>
  mutateState(state => consumeForceInState(state, userId, date))

export const checkForceUsage = (userId, date = todayStr()) => getState().force_usage?.[String(userId)] !== date

export const refillGroupCharges = async (userIds, options = {}) => {
  const now = Number(options.now) || Date.now() / 1000
  const { chargeMax } = normalizeChargeSettings(options)
  return mutateState(state => {
    state.usage ||= {}
    const benefited = []
    for (const rawId of userIds || []) {
      const uid = String(rawId)
      if (!uid) continue
      const previous = state.usage[uid]
      const last = previous && typeof previous === 'object' ? previous.last_roast_ts : (previous || null)
      state.usage[uid] = {
        last_roast_ts: last,
        roast_charges: chargeMax,
        roast_charge_updated_ts: now
      }
      benefited.push(uid)
    }
    return benefited
  })
}
