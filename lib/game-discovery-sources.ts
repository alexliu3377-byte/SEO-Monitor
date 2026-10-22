export const GAME_DISCOVERY_SOURCES = {
  momo_rising: { provider: 'momorank', label: '上升榜', url: 'https://www.momorank.com/rising?type=bestseller&view=daily', limit: 10, note: '畅销榜名次变化，不代表收入或用户增长；新进榜不等于新上线。' },
  momo_popularity: { provider: 'momorank', label: '人气榜', url: 'https://www.momorank.com/rankings/popular', limit: 10, note: 'MomoRank 展示的人气榜，不代表百度搜索量。' },
  momo_bestseller: { provider: 'momorank', label: '畅销榜', url: 'https://www.momorank.com/rankings/bestseller', limit: 10, note: 'MomoRank 展示的畅销榜，不代表下载量或百度搜索量。' },
  momo_bestplay: { provider: 'momorank', label: '畅玩榜', url: 'https://www.momorank.com/rankings/most_played', limit: 10, note: 'MomoRank 展示的畅玩榜，按来源口径查看。' },
  momo_hot_search: { provider: 'momorank', label: '热搜访问', url: 'https://www.momorank.com/insights/hot-search', limit: 10, note: '来源按搜索后的访问情况等指标计算，不是百度搜索量。' },
  momo_ip: { provider: 'momorank', label: 'IP 热度', url: 'https://www.momorank.com/insights/ip-trends?sort=4', limit: 10, note: '按来源搜索、阅读等指标计算的综合热度，不是游戏搜索次数。' },
  momo_hot_words: { provider: 'momorank', label: '热搜词', url: 'https://www.momorank.com/insights/hot-words', limit: 10, note: '来源按搜索热度等指标计算，不是百度下拉或百度搜索量。' },
  wechat_popularity: { provider: 'wechat', label: '人气榜', url: 'https://xiaoyouxi.qq.com/rankdetail/3.html', limit: 100, note: '官网展示快照，来源资料日期未提供、时效未确认；不是最新上线榜。' },
  wechat_bestseller: { provider: 'wechat', label: '畅销榜', url: 'https://xiaoyouxi.qq.com/rankdetail/2.html', limit: 100, note: '官网展示快照，来源资料日期未提供、时效未确认；不是最新上线榜。' },
  wechat_bestplay: { provider: 'wechat', label: '畅玩榜', url: 'https://xiaoyouxi.qq.com/rankdetail/4.html', limit: 100, note: '官网展示快照，来源资料日期未提供、时效未确认；不是最新上线榜。' },
} as const
export type GameDiscoveryDataset = keyof typeof GAME_DISCOVERY_SOURCES
export const MOMORANK_DATASETS: GameDiscoveryDataset[] = ['momo_rising','momo_popularity','momo_bestseller','momo_bestplay','momo_hot_search','momo_ip']
export const WECHAT_DATASETS: GameDiscoveryDataset[] = ['wechat_popularity','wechat_bestseller','wechat_bestplay']
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
}
export function validSourceDate(value: unknown): value is string {
  return typeof value === 'string' && /^20\d{2}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0,10) === value
}
export function validateGameDiscoveryCollection(value: unknown): GameDiscoveryCollection {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('来源资料无效')
  const data = value as Record<string, unknown>
  if (!isGameDiscoveryDataset(data.dataset)) throw new Error('来源无效')
  const config = GAME_DISCOVERY_SOURCES[data.dataset]
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
      const url = new URL(row.url)
      if (url.origin !== 'https://www.momorank.com' || !/^\/games\/\d+$/.test(url.pathname) || url.username || url.password || row.url.length > 2048) throw new Error('来源链接无效')
    }
  })
  // Whitelist only normalized public fields, never raw HTML/embedded data.
  return { dataset: data.dataset, collectedAt: data.collectedAt, sourceDate: data.sourceDate as string | null,
    sourceModifiedAt: data.sourceModifiedAt as string | null, items: data.items.map(item => ({ position: item.position, sourceId: item.sourceId,
      title: item.title, summary: item.summary, url: item.url, metric: item.metric, change: item.change, tags: item.tags })) }
}
