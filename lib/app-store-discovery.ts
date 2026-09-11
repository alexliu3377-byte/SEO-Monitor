import type { AppStoreChart } from './app-store'

export const APP_STORE_DISCOVERY_COUNTRIES = ['cn', 'hk', 'tw', 'my', 'sg', 'us', 'jp'] as const
export const APP_STORE_DISCOVERY_CHARTS: AppStoreChart[] = ['top-free', 'top-paid']
export const APP_STORE_DISCOVERY_MODES = ['mixed', 'apps', 'games'] as const
export type AppStoreDiscoveryMode = typeof APP_STORE_DISCOVERY_MODES[number]

const APP_CATEGORY_TERMS = [
  '软件', '工具', '效率', '办公', '学习', '生活', '社交', '视频', '音乐', '摄影',
  '健康', '旅行', '购物', '人工智能', '播放器', '壁纸', '浏览器', '翻译', '记账', '地图', '阅读',
  'app', 'tools', 'productivity', 'utility', 'photo', 'video', 'music', 'social', 'finance',
  'education', 'health', 'travel', 'shopping', 'AI', 'browser', 'editor', 'scanner', 'notes', 'calendar',
  'weather',
]

const GAME_CATEGORY_TERMS = [
  '游戏', '手游', '新游戏', '新手游', '热门游戏', '独立游戏', '单机游戏', '联机游戏',
  '角色扮演', '策略游戏', '卡牌游戏', '射击游戏', '模拟经营', '休闲游戏', '益智游戏',
  '动作游戏', '冒险游戏', '竞技游戏', '赛车游戏', '体育游戏', '音乐游戏', '文字游戏',
  '放置游戏', '塔防游戏', '生存游戏', '开放世界', '二次元游戏',
  'game', 'mobile game', 'new game', 'indie game', 'RPG', 'strategy game', 'card game',
  'shooter game', 'simulation game', 'casual game', 'puzzle game', 'action game',
  'adventure game', 'racing game', 'sports game', 'survival game', 'tower defense',
]

const COMMON_CHINESE = Array.from('的一是在不了有和人这中大为上个国我以要他时来用们生到作地于出就分对成会可主发年动同工也能下过子说产种面而方后多定行学法所民得经十三之进着等部度家电力里如水化高自二理起小物现实加量都两体制机当使点从业本去把性好应开它合还因由其些然前外天政四日那社义事平形相全表间样与关各重新线内数正心反你明看原又么利比或但质气第向道命此变条只没结解问意建月公无系军很情者最立代想已通并提直题党程展五果料象员革位入常文总次品式活设及管特件长求老头基资边流路级少图山统接知较将组见计别她手角期根论运农指几九区强放决西被干做必战先回则任取据处理世车')
const LATIN_PAIRS = Array.from({ length: 26 * 26 }, (_, index) => (
  String.fromCharCode(97 + Math.floor(index / 26)) + String.fromCharCode(97 + (index % 26))
))

export const APP_STORE_APP_DISCOVERY_TERMS = [...APP_CATEGORY_TERMS, ...COMMON_CHINESE, ...LATIN_PAIRS]
export const APP_STORE_GAME_DISCOVERY_TERMS = [
  ...GAME_CATEGORY_TERMS,
  ...LATIN_PAIRS.map(pair => `${pair} game`),
]
export const APP_STORE_DISCOVERY_TERMS = [
  ...APP_STORE_APP_DISCOVERY_TERMS,
  ...APP_STORE_GAME_DISCOVERY_TERMS,
]

function utcDayNumber(date: Date): number {
  return Math.floor(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) / 86_400_000)
}

function rotatingTerms(terms: string[], cycle: number, count: number) {
  const start = (cycle * count) % terms.length
  return Array.from({ length: count }, (_, offset) => terms[(start + offset) % terms.length])
}

export function appStoreDailyDiscoveryPlan(
  date = new Date(),
  queryCount = 12,
  mode: AppStoreDiscoveryMode = 'mixed',
) {
  const day = utcDayNumber(date)
  const countryIndex = day % APP_STORE_DISCOVERY_COUNTRIES.length
  const country = APP_STORE_DISCOVERY_COUNTRIES[countryIndex]
  const cycle = Math.floor(day / APP_STORE_DISCOVERY_COUNTRIES.length)
  const safeCount = Math.min(12, Math.max(1, Math.trunc(queryCount) || 12))
  let terms: string[]

  if (mode === 'games') {
    terms = rotatingTerms(APP_STORE_GAME_DISCOVERY_TERMS, cycle, safeCount)
  } else if (mode === 'apps') {
    terms = rotatingTerms(APP_STORE_APP_DISCOVERY_TERMS, cycle, safeCount)
  } else {
    const gameCount = Math.floor(safeCount / 2)
    const appCount = safeCount - gameCount
    const appTerms = rotatingTerms(APP_STORE_APP_DISCOVERY_TERMS, cycle, appCount)
    const gameTerms = rotatingTerms(APP_STORE_GAME_DISCOVERY_TERMS, cycle, gameCount)
    terms = Array.from({ length: safeCount }, (_, index) => (
      index % 2 === 0 ? appTerms.shift() : gameTerms.shift()
    )).filter((term): term is string => Boolean(term))
  }

  return { country, mode, terms, charts: APP_STORE_DISCOVERY_CHARTS }
}
