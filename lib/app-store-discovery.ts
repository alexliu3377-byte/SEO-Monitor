import type { AppStoreChart } from './app-store'

export const APP_STORE_DISCOVERY_COUNTRIES = ['cn', 'hk', 'tw', 'my', 'sg', 'us', 'jp'] as const
export const APP_STORE_DISCOVERY_CHARTS: AppStoreChart[] = ['top-free', 'top-paid']

const CATEGORY_TERMS = [
  '游戏', '手游', '软件', '工具', '效率', '办公', '学习', '生活', '社交', '视频', '音乐', '摄影',
  '健康', '旅行', '购物', '人工智能', '播放器', '壁纸', '浏览器', '翻译', '记账', '地图', '阅读',
  'game', 'app', 'tools', 'productivity', 'utility', 'photo', 'video', 'music', 'social', 'finance',
  'education', 'health', 'travel', 'shopping', 'AI', 'browser', 'editor', 'scanner', 'notes', 'calendar',
  'weather', 'puzzle', 'strategy', 'RPG', 'casual', 'simulation', 'sports', 'racing', 'action', 'adventure',
]

const COMMON_CHINESE = Array.from('的一是在不了有和人这中大为上个国我以要他时来用们生到作地于出就分对成会可主发年动同工也能下过子说产种面而方后多定行学法所民得经十三之进着等部度家电力里如水化高自二理起小物现实加量都两体制机当使点从业本去把性好应开它合还因由其些然前外天政四日那社义事平形相全表间样与关各重新线内数正心反你明看原又么利比或但质气第向道命此变条只没结解问意建月公无系军很情者最立代想已通并提直题党程展五果料象员革位入常文总次品式活设及管特件长求老头基资边流路级少图山统接知较将组见计别她手角期根论运农指几九区强放决西被干做必战先回则任取据处理世车')
const LATIN_PAIRS = Array.from({ length: 26 * 26 }, (_, index) => (
  String.fromCharCode(97 + Math.floor(index / 26)) + String.fromCharCode(97 + (index % 26))
))

export const APP_STORE_DISCOVERY_TERMS = [...CATEGORY_TERMS, ...COMMON_CHINESE, ...LATIN_PAIRS]

function utcDayNumber(date: Date): number {
  return Math.floor(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) / 86_400_000)
}

export function appStoreDailyDiscoveryPlan(date = new Date(), queryCount = 8) {
  const day = utcDayNumber(date)
  const countryIndex = day % APP_STORE_DISCOVERY_COUNTRIES.length
  const country = APP_STORE_DISCOVERY_COUNTRIES[countryIndex]
  const cycle = Math.floor(day / APP_STORE_DISCOVERY_COUNTRIES.length)
  const safeCount = Math.min(12, Math.max(1, Math.trunc(queryCount) || 8))
  const start = (cycle * safeCount) % APP_STORE_DISCOVERY_TERMS.length
  const terms = Array.from({ length: safeCount }, (_, offset) => (
    APP_STORE_DISCOVERY_TERMS[(start + offset) % APP_STORE_DISCOVERY_TERMS.length]
  ))
  return { country, terms, charts: APP_STORE_DISCOVERY_CHARTS }
}
