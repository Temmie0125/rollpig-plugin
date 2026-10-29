// 烤猪规则与结果构造：特殊形态拦截、概率、反噬、后门口令、AI/本地文案。
import {
  canBackfireRoast,
  isEatenPig,
  isFoodPig,
  isHumanPig,
  isSoldPig,
  pickFoodPig as pickFoodPigFromPool
} from '../pigs.js'
import { formatText, pickText, texts } from '../texts.js'
import { getRoastText } from '../ai-roast.js'

export const pickFoodPig = officialPigs => pickFoodPigFromPool(officialPigs)

export const pickSelfRoastBlock = pig => {
  if (isHumanPig(pig)) return pickText(texts.TODAY_ROAST_HUMAN_BLOCK_TEXTS)
  if (isEatenPig(pig)) return pickText(texts.TODAY_ROAST_EATEN_BLOCK_TEXTS)
  if (isSoldPig(pig)) return pickText(texts.TODAY_ROAST_SOLD_BLOCK_TEXTS)
  if (isFoodPig(pig)) {
    return formatText(pickText(texts.TODAY_ROAST_FOOD_BLOCK_TEXTS), { shape: pig?.name || '熟食' })
  }
  return ''
}

export const pickMemberTargetBlock = (targetName, pig) => {
  if (isHumanPig(pig)) return formatText(pickText(texts.TARGET_HUMAN_BLOCK_TEXTS), { target: targetName })
  if (isEatenPig(pig)) return formatText(pickText(texts.TARGET_EATEN_BLOCK_TEXTS), { target: targetName })
  if (isSoldPig(pig)) return formatText(pickText(texts.TARGET_SOLD_BLOCK_TEXTS), { target: targetName })
  if (isFoodPig(pig)) {
    return formatText(pickText(texts.TARGET_FOOD_BLOCK_TEXTS), { target: targetName, shape: pig?.name || '熟食' })
  }
  return ''
}

export const pickRandomTargetBlock = (targetName, pig) => {
  if (isHumanPig(pig)) return `系统随机选中了【${targetName}】，但对方是人类形态，烤架拒绝处理。换一次试试？`
  if (isEatenPig(pig)) return formatText(pickText(texts.TARGET_EATEN_BLOCK_TEXTS), { target: targetName })
  if (isSoldPig(pig)) return formatText(pickText(texts.TARGET_SOLD_BLOCK_TEXTS), { target: targetName })
  if (isFoodPig(pig)) return `系统随机选中了【${targetName}】，但对方已经是【${pig?.name || '熟食'}】了，别鞭尸了。`
  return ''
}

export const pickBackfireText = (attackerName, targetName, attackerPig) => {
  let pool = texts.BACKFIRE_GENERIC_TEXTS
  let shape = attackerPig?.name || '未知形态'
  if (!attackerPig) {
    pool = texts.BACKFIRE_NO_PIG_TEXTS
    shape = '未抽形态'
  } else if (isHumanPig(attackerPig)) {
    pool = texts.BACKFIRE_HUMAN_TEXTS
    shape = '人类'
  } else if (isEatenPig(attackerPig)) {
    pool = texts.BACKFIRE_EATEN_TEXTS
    shape = '吃掉了'
  } else if (isSoldPig(attackerPig)) {
    pool = texts.BACKFIRE_SOLD_TEXTS
    shape = '卖掉了'
  } else if (isFoodPig(attackerPig)) {
    pool = texts.BACKFIRE_FOOD_TEXTS
  }
  return formatText(pickText(pool), { attacker: attackerName, target: targetName, shape })
}

/** 反噬文案里的“你”明确改成攻击者，避免读者误以为在说目标 */
export const clarifyBackfireText = (roastText, attackerName) => {
  const text = String(roastText || '').trim()
  if (!text) return text
  if (attackerName && text.includes(attackerName)) return text
  const label = `【${attackerName || '对方'}】`
  const replacements = [
    ['曾经你', `曾经${label}`],
    ['如今你', `如今${label}`],
    ['生前你', `生前${label}`],
    ['原本你', `原本${label}`],
    ['原来你', `原来${label}`],
    ['你本是一只', `${label}本是一只`],
    ['你本是', `${label}本是`],
    ['你曾经是', `${label}曾经是`],
    ['你曾是', `${label}曾是`],
    ['你虽然', `${label}虽然`],
    ['你从', `${label}从`],
    ['看看你', `看看${label}`],
    ['可怜的你', `可怜的${label}`],
    ['没想到你', `没想到${label}`]
  ]
  for (const [oldText, newText] of replacements) {
    if (text.includes(oldText)) return text.replace(oldText, newText)
  }
  if (text.includes('你')) return text.replace('你', label)
  return `${label}原本想把别人送上烤架，结果最后被端上桌的却是自己。${text}`
}

export const pickEscapeText = (attackerName, targetName, targetPig) => formatText(
  pickText(texts.ESCAPE_TEXTS),
  { attacker: attackerName, target: targetName, shape: targetPig?.name || '未知形态' }
)

export const pickForcePrefix = (targetName, isSuper) => formatText(
  pickText(isSuper ? texts.SUPER_FORCE_ROAST_PREFIX_TEXTS : texts.FORCE_ROAST_PREFIX_TEXTS),
  { target: targetName }
)

export const pickForceLimitText = (operatorName, targetName) => formatText(
  pickText(texts.FORCE_ROAST_LIMIT_TEXTS),
  { operator: operatorName, target: targetName }
)

export const detectForceMode = (rawText, isMaster) => {
  const normalized = String(rawText || '').replace(/[/\s　]/g, '')
  const superKeyword = String(texts.SUPER_FORCE_ROAST_KEYWORD || '强行点火')
  if (normalized.includes(superKeyword)) return isMaster ? 'super' : 'super_denied'
  const keywords = Array.isArray(texts.FORCE_ROAST_KEYWORDS) ? texts.FORCE_ROAST_KEYWORDS : []
  if (keywords.some(keyword => normalized.includes(keyword))) return 'normal'
  return null
}

export const buildSelfRoastData = async (originalPig, officialPigs) => {
  const foodPig = pickFoodPig(officialPigs)
  const roastText = await getRoastText({ originPig: originalPig, foodPig })
  return {
    renderData: { ...foodPig, analysis: roastText },
    foodName: foodPig.name
  }
}

export const buildSuccessOutcome = async (targetPig, {
  officialPigs,
  attackerName,
  targetName,
  extraText = ''
}) => {
  const foodPig = pickFoodPig(officialPigs)
  const roastText = await getRoastText({
    originPig: targetPig,
    foodPig,
    operatorName: attackerName,
    targetName
  })
  return {
    type: 'success',
    renderData: { ...foodPig, analysis: roastText },
    plainText: '',
    extraText,
    foodName: foodPig.name,
    specialReason: ''
  }
}

export const buildBackfireOutcome = async (attackerPig, {
  officialPigs,
  attackerName,
  targetName,
  extraText = ''
}) => {
  const failIntro = pickBackfireText(attackerName, targetName, attackerPig)
  if (!canBackfireRoast(attackerPig)) {
    return {
      type: 'backfire',
      renderData: null,
      plainText: extraText + failIntro,
      extraText: '',
      foodName: '',
      specialReason: ''
    }
  }
  const foodPig = pickFoodPig(officialPigs)
  const roastText = clarifyBackfireText(
    await getRoastText({ originPig: attackerPig, foodPig }),
    attackerName
  )
  return {
    type: 'backfire',
    renderData: { ...foodPig, analysis: `${failIntro}\n\n${roastText}` },
    plainText: '',
    extraText,
    foodName: foodPig.name,
    specialReason: ''
  }
}

/** 执行烤群友核心判定：60 成功 / 30 逃脱 / 10 反噬；后门必中 */
export const buildMemberRoastOutcome = async ({
  attackerPig,
  targetPig,
  attackerName,
  targetName,
  forceMode = null,
  introText = '',
  officialPigs
}) => {
  if (forceMode === 'normal' || forceMode === 'super') {
    return buildSuccessOutcome(targetPig, {
      officialPigs,
      attackerName,
      targetName,
      extraText: pickForcePrefix(targetName, forceMode === 'super')
    })
  }
  const roll = Math.floor(Math.random() * 100) + 1
  if (roll <= 60) {
    return buildSuccessOutcome(targetPig, {
      officialPigs,
      attackerName,
      targetName,
      extraText: introText
    })
  }
  if (roll <= 90) {
    return {
      type: 'escape',
      renderData: null,
      plainText: introText + pickEscapeText(attackerName, targetName, targetPig),
      extraText: '',
      foodName: '',
      specialReason: ''
    }
  }
  return buildBackfireOutcome(attackerPig, {
    officialPigs,
    attackerName,
    targetName,
    extraText: introText
  })
}

/** 保护目标被成功烤成时，保护等级临时 +1 的提示 */
export const pickProtectionLevelUpText = (name, level) => formatText(
  pickText(texts.PROTECTION_LEVEL_UP_TEXTS),
  { name, level }
)
