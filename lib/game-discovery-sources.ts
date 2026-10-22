export const GAME_DISCOVERY_SOURCES = {
  momo_overview: { provider: 'momorank', label: '排行榜', url: 'https://www.momorank.com/', limit: 10, note: '微信小游戏排行榜概览，按来源当天快照展示。' },
  momo_douyin_overview: { provider: 'momorank', label: '排行榜', url: 'https://www.momorank.com/douyin', limit: 10, note: '抖音小游戏排行榜概览，按来源当天快照展示。' },
  momo_rising: { provider: 'momorank', label: '上升榜', url: 'https://www.momorank.com/rising?type=bestseller&view=daily', limit: 10, note: '畅销榜名次变化，不代表收入或用户增长；新进榜不等于新上线。' },
  momo_rising_popularity: { provider: 'momorank', label: '上升榜', url: 'https://www.momorank.com/rising?type=popular&view=daily', limit: 10, note: '人气榜今日上升，名次变化不代表搜索量。' },
  momo_rising_bestplay: { provider: 'momorank', label: '上升榜', url: 'https://www.momorank.com/rising?type=most_played&view=daily', limit: 10, note: '畅玩榜今日上升，名次变化不代表搜索量。' },
  momo_popularity: { provider: 'momorank', label: '人气榜', url: 'https://www.momorank.com/rankings/popular', limit: 10, note: 'MomoRank 展示的人气榜，不代表百度搜索量。' },
  momo_bestseller: { provider: 'momorank', label: '畅销榜', url: 'https://www.momorank.com/rankings/bestseller', limit: 10, note: 'MomoRank 展示的畅销榜，不代表下载量或百度搜索量。' },
  momo_bestplay: { provider: 'momorank', label: '畅玩榜', url: 'https://www.momorank.com/rankings/most_played', limit: 10, note: 'MomoRank 展示的畅玩榜，按来源口径查看。' },
  momo_hot_search: { provider: 'momorank', label: '热搜访问', url: 'https://www.momorank.com/insights/hot-search', limit: 10, note: '来源按搜索后的访问情况等指标计算，不是百度搜索量。' },
  momo_ip: { provider: 'momorank', label: 'IP 热度', url: 'https://www.momorank.com/insights/ip-trends?sort=4', limit: 10, note: '按来源搜索、阅读等指标计算的综合热度，不是游戏搜索次数。' },
  momo_hot_words: { provider: 'momorank', label: '热搜词', url: 'https://www.momorank.com/insights/hot-words', limit: 10, note: '来源按搜索热度等指标计算，不是百度下拉或百度搜索量。' },
  momo_douyin_popularity: { provider: 'momorank', label: '热门榜', url: 'https://www.momorank.com/douyin/rankings/popular', limit: 10, note: '抖音小游戏热门榜，按来源访问用户量等指标计算。' },
  momo_douyin_bestseller: { provider: 'momorank', label: '畅销榜', url: 'https://www.momorank.com/douyin/rankings/bestseller', limit: 10, note: '抖音小游戏畅销榜，不代表百度搜索量。' },
  momo_douyin_new: { provider: 'momorank', label: '新游榜', url: 'https://www.momorank.com/douyin/rankings/new_game', limit: 10, note: '来源新游榜，不将排名日期当作上线日期。' },
  momo_douyin_publisher: { provider: 'momorank', label: '发行人热度榜', url: 'https://www.momorank.com/douyin/rankings/publisher_heat', limit: 10, note: '依据近一周发行人场景营收能力计算的游戏榜单，不是发行公司排名。' },
  momo_douyin_rising_popularity: { provider: 'momorank', label: '上升榜', url: 'https://www.momorank.com/douyin/rising?type=popular&view=daily', limit: 10, note: '热门榜今日上升，名次变化不代表收入或用户增长。' },
  momo_douyin_rising_bestseller: { provider: 'momorank', label: '上升榜', url: 'https://www.momorank.com/douyin/rising?type=bestseller&view=daily', limit: 10, note: '畅销榜今日上升，名次变化不代表收入或用户增长。' },
  momo_douyin_rising_new: { provider: 'momorank', label: '上升榜', url: 'https://www.momorank.com/douyin/rising?type=new_game&view=daily', limit: 10, note: '新游榜今日上升，新进榜不等于新上线。' },
  momo_douyin_rising_publisher: { provider: 'momorank', label: '上升榜', url: 'https://www.momorank.com/douyin/rising?type=publisher_heat&view=daily', limit: 10, note: '发行人热度榜今日上升，按来源口径查看。' },
  wechat_popularity: { provider: 'wechat', label: '人气榜', url: 'https://xiaoyouxi.qq.com/rankdetail/3.html', limit: 100, note: '官网展示快照，来源资料日期未提供、时效未确认；不是最新上线榜。' },
  wechat_bestseller: { provider: 'wechat', label: '畅销榜', url: 'https://xiaoyouxi.qq.com/rankdetail/2.html', limit: 100, note: '官网展示快照，来源资料日期未提供、时效未确认；不是最新上线榜。' },
  wechat_bestplay: { provider: 'wechat', label: '畅玩榜', url: 'https://xiaoyouxi.qq.com/rankdetail/4.html', limit: 100, note: '官网展示快照，来源资料日期未提供、时效未确认；不是最新上线榜。' },
} as const
export type GameDiscoveryDataset = keyof typeof GAME_DISCOVERY_SOURCES
export type MomoPlatform = 'wechat' | 'douyin'
export const MOMORANK_TABS = {
  wechat: ['momo_overview','momo_rising','momo_bestseller','momo_popularity','momo_bestplay','momo_hot_search'],
  douyin: ['momo_douyin_overview','momo_douyin_rising_popularity','momo_douyin_popularity','momo_douyin_bestseller','momo_douyin_new','momo_douyin_publisher'],
} as const satisfies Record<MomoPlatform, readonly GameDiscoveryDataset[]>
export const MOMORANK_RISING = {
  wechat: [{dataset:'momo_rising',label:'畅销榜'},{dataset:'momo_rising_popularity',label:'人气榜'},{dataset:'momo_rising_bestplay',label:'畅玩榜'}],
  douyin: [{dataset:'momo_douyin_rising_popularity',label:'热门榜'},{dataset:'momo_douyin_rising_bestseller',label:'畅销榜'},{dataset:'momo_douyin_rising_new',label:'新游榜'},{dataset:'momo_douyin_rising_publisher',label:'发行人热度榜'}],
} as const satisfies Record<MomoPlatform, readonly {dataset:GameDiscoveryDataset;label:string}[]>
// Retain old dataset validators for compatibility, but no longer collect IP / hot-words.
export const MOMORANK_DATASETS: GameDiscoveryDataset[] = [...new Set<GameDiscoveryDataset>([...MOMORANK_TABS.wechat,...MOMORANK_TABS.douyin,...MOMORANK_RISING.wechat.map(row=>row.dataset),...MOMORANK_RISING.douyin.map(row=>row.dataset)])]
export const WECHAT_DATASETS: GameDiscoveryDataset[] = ['wechat_popularity','wechat_bestseller','wechat_bestplay']
export const isMomoOverview = (dataset:GameDiscoveryDataset) => dataset==='momo_overview' || dataset==='momo_douyin_overview'
export const isMomoRising = (dataset:GameDiscoveryDataset) => dataset==='momo_rising' || dataset.includes('_rising_')
export function isMomoGameUrl(value:unknown): value is string {
  if(typeof value!=='string' || value.length>2048)return false
  try { const url=new URL(value);return url.origin==='https://www.momorank.com' && !url.username && !url.password && /^\/(douyin\/)?games\/\d+$/.test(url.pathname) } catch {return false}
}
export function isGameDiscoveryDataset(value: unknown): value is GameDiscoveryDataset {
  return typeof value === 'string' && Object.hasOwn(GAME_DISCOVERY_SOURCES, value)
}
export type GameDiscoveryItem = {
  position: number
  sourceId: string
  title: string
  summary: string | null
  url: string | null
  metric: string | null
  change: string | null
  tags: string[]
}
export type GameDiscoveryCollection = {
  dataset: GameDiscoveryDataset
  collectedAt: string
  sourceDate: string | null
  sourceModifiedAt: string | null
  items: GameDiscoveryItem[]
  highlights?: GameDiscoveryHighlights
}
export type GameDiscoveryHighlights = {
  changes: Array<{label:string;items:Array<{title:string;url:string|null;change:string|null}>}>
  rising: GameDiscoveryItem[]
}
export function validSourceDate(value: unknown): value is string {
  return typeof value === 'string' && /^20\d{2}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0,10) === value
}
export function validateGameDiscoveryCollection(value: unknown): GameDiscoveryCollection {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('来源资料无效')
  const data = value as Record<string, unknown>
  if (!isGameDiscoveryDataset(data.dataset)) throw new Error('来源无效')
  const dataset=data.dataset, config = GAME_DISCOVERY_SOURCES[dataset]
  if (typeof data.collectedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(data.collectedAt)
    || !Number.isFinite(Date.parse(data.collectedAt)) || Date.parse(data.collectedAt) > Date.now() + 300_000) throw new Error('采集时间无效')
  const today = new Date(Date.now() + 8 * 3600_000).toISOString().slice(0,10)
  if (config.provider === 'momorank' ? !validSourceDate(data.sourceDate) || data.sourceDate > today : data.sourceDate !== null) throw new Error('来源日期无效')
  if (data.sourceModifiedAt !== null && (typeof data.sourceModifiedAt !== 'string' || !Number.isFinite(Date.parse(data.sourceModifiedAt)))) throw new Error('网页修改时间无效')
  if (!Array.isArray(data.items) || !data.items.length || data.items.length > config.limit) throw new Error('来源资料数量无效')
  const ids = new Set<string>()
  data.items.forEach((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('条目无效')
    const row = item as Record<string, unknown>
    if (row.position !== index + 1 || typeof row.sourceId !== 'string' || !row.sourceId.trim() || row.sourceId.length > 240 || ids.has(row.sourceId)
      || typeof row.title !== 'string' || !row.title.trim() || row.title.length > 240
      || (row.summary !== null && (typeof row.summary !== 'string' || row.summary.length > 500))
      || (row.metric !== null && (typeof row.metric !== 'string' || row.metric.length > 100))
      || (row.change !== null && (typeof row.change !== 'string' || row.change.length > 100))
      || !Array.isArray(row.tags) || row.tags.length > 8 || row.tags.some(tag => typeof tag !== 'string' || tag.length > 40)) throw new Error('条目字段无效')
    ids.add(row.sourceId)
    if (config.provider === 'wechat' && (!/^wx[a-f0-9]{16}$/.test(row.sourceId) || row.url !== null)) throw new Error('微信游戏标识无效')
    if (row.url !== null) {
      if (typeof row.url !== 'string') throw new Error('来源链接无效')
      if (!isMomoGameUrl(row.url)) throw new Error('来源链接无效')
      if(dataset.startsWith('momo_douyin_') !== new URL(row.url).pathname.startsWith('/douyin/'))throw new Error('来源平台不匹配')
    }
  })
  const rawHighlights=data.highlights as GameDiscoveryHighlights | undefined
  let highlights:GameDiscoveryHighlights={changes:[],rising:[]}
  if(rawHighlights!==undefined){
    if(!rawHighlights || !Array.isArray(rawHighlights.changes) || rawHighlights.changes.length>4 || !Array.isArray(rawHighlights.rising) || rawHighlights.rising.length>10)throw new Error('变化摘要无效')
    highlights={changes:rawHighlights.changes.map(group=>{
      if(!group || typeof group.label!=='string' || !['新进榜','上升','下降','脱榜'].includes(group.label) || !Array.isArray(group.items) || group.items.length>10)throw new Error('变化分组无效')
      return {label:group.label,items:group.items.map(row=>{
        if(!row || typeof row.title!=='string' || !row.title.trim() || row.title.length>240 || (row.change!==null && (typeof row.change!=='string' || row.change.length>100)) || (row.url!==null && (!isMomoGameUrl(row.url) || dataset.startsWith('momo_douyin_')!==new URL(row.url).pathname.startsWith('/douyin/'))))throw new Error('变化条目无效')
        return {title:row.title,url:row.url,change:row.change}
      })}
    }),rising:[]}
    if(rawHighlights.rising.length){
      if(!isMomoOverview(data.dataset))throw new Error('非概览资料不能附加上升榜')
      highlights.rising=validateGameDiscoveryCollection({...data,items:rawHighlights.rising,highlights:undefined}).items
    }
    if(config.provider!=='momorank' && (highlights.changes.length || highlights.rising.length))throw new Error('来源不支持变化摘要')
  }
  // Whitelist only normalized public fields, never raw HTML/embedded data.
  return { dataset: data.dataset, collectedAt: data.collectedAt, sourceDate: data.sourceDate as string | null,
    sourceModifiedAt: data.sourceModifiedAt as string | null, highlights, items: data.items.map(item => ({ position: item.position, sourceId: item.sourceId,
      title: item.title, summary: item.summary, url: item.url, metric: item.metric, change: item.change, tags: item.tags })) }
}
