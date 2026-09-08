export const TREND_PLATFORMS = ['xiaohongshu', 'douyin', 'xiaoheihe'] as const
export type TrendPlatform = typeof TREND_PLATFORMS[number]

export const TREND_STAGES = ['new', 'warming', 'hot', 'persistent', 'cooling'] as const
export type TrendStage = typeof TREND_STAGES[number]

export const TREND_REVIEW_STATUSES = ['pending', 'tracked', 'dismissed'] as const
export type TrendReviewStatus = typeof TREND_REVIEW_STATUSES[number]

export type TrendMetrics = Partial<Record<
  'likes' | 'comments' | 'shares' | 'collects' | 'views' | 'hotValue',
  number
>>

export type TrendSignalInput = {
  externalId: string
  sourceUrl: string
  title: string
  excerpt: string | null
  tags: string[]
  candidateTerms: string[]
  queryTerm: string | null
  publishedAt: string | null
  collectedAt: string
  metrics: TrendMetrics
}

const PLATFORM_HOSTS: Record<TrendPlatform, readonly string[]> = {
  xiaohongshu: ['xiaohongshu.com', 'xhslink.com'],
  douyin: ['douyin.com'],
  xiaoheihe: ['xiaoheihe.cn', 'heybox.hk'],
}

const TERM_STOP_WORDS = new Set([
  'app', 'android', 'ios', 'iphone', 'ipad', 'windows', 'mac',
  '游戏', '手游', '软件', '应用', '工具', '版本', '更新', '下载', '推荐',
  '体验', '教程', '攻略', '今天', '最新', '一个', '这个', '什么', '怎么',
])

export function isTrendPlatform(value: unknown): value is TrendPlatform {
  return typeof value === 'string' && (TREND_PLATFORMS as readonly string[]).includes(value)
}

export function isTrendStage(value: unknown): value is TrendStage {
  return typeof value === 'string' && (TREND_STAGES as readonly string[]).includes(value)
}

export function isTrendReviewStatus(value: unknown): value is TrendReviewStatus {
  return typeof value === 'string' && (TREND_REVIEW_STATUSES as readonly string[]).includes(value)
}

export function cleanTrendText(value: unknown, maxLength: number): string {
  if (typeof value !== 'string') return ''
  return value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLength)
}

export function normalizeTrendTerm(value: unknown): string | null {
  const cleaned = cleanTrendText(value, 80)
    .replace(/^#+/, '')
    .replace(/[【】《》「」“”"'‘’()[\]{}]/g, '')
    .replace(/[，。！？、；：,.!?;:|/\\]+$/g, '')
    .trim()
  if (cleaned.length < 2 || cleaned.length > 80) return null
  const normalized = cleaned.toLocaleLowerCase('zh-CN')
  if (TERM_STOP_WORDS.has(normalized)) return null
  if (/^\d+$/.test(normalized)) return null
  return normalized
}

export function extractCandidateTerms(title: string, supplied: readonly string[] = []): string[] {
  const candidates = new Set<string>()
  for (const value of supplied) {
    const normalized = normalizeTrendTerm(value)
    if (normalized) candidates.add(normalized)
  }

  const text = cleanTrendText(title, 500)
  for (const match of text.matchAll(/#([\p{L}\p{N}_·-]{2,40})/gu)) {
    const normalized = normalizeTrendTerm(match[1])
    if (normalized) candidates.add(normalized)
  }
  for (const match of text.matchAll(/[《【「“]([^》】」”]{2,40})[》】」”]/gu)) {
    const normalized = normalizeTrendTerm(match[1])
    if (normalized) candidates.add(normalized)
  }
  for (const match of text.matchAll(/(?:叫做|名为|游戏名|应用名)[：:\s]*([\p{Script=Han}A-Za-z0-9·_-]{2,30})/gu)) {
    const normalized = normalizeTrendTerm(match[1])
    if (normalized) candidates.add(normalized)
  }
  for (const match of text.matchAll(/\b([A-Z][A-Za-z0-9_-]{2,24})\b/g)) {
    const normalized = normalizeTrendTerm(match[1])
    if (normalized) candidates.add(normalized)
  }
  return [...candidates].slice(0, 20)
}

export function normalizeTrendSourceUrl(platform: TrendPlatform, value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 1000) return null
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return null
    const hostname = url.hostname.toLowerCase().replace(/\.$/, '')
    const allowed = PLATFORM_HOSTS[platform].some(host => hostname === host || hostname.endsWith(`.${host}`))
    if (!allowed) return null

    // Search/result links often carry session-like tracking parameters. The
    // stable content path is enough for source review and avoids storing them.
    url.username = ''
    url.password = ''
    url.search = ''
    url.hash = ''
    return url.toString()
  } catch {
    return null
  }
}

export function isAllowedTrendSourceUrl(platform: TrendPlatform, value: unknown): boolean {
  return normalizeTrendSourceUrl(platform, value) !== null
}

export function cleanTrendMetrics(value: unknown): TrendMetrics {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const result: TrendMetrics = {}
  const allowed = ['likes', 'comments', 'shares', 'collects', 'views', 'hotValue'] as const
  for (const key of allowed) {
    const raw = (value as Record<string, unknown>)[key]
    if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 0) {
      result[key] = Math.min(Math.round(raw), 2_000_000_000)
    }
  }
  return result
}

export function computeTrendScore(input: {
  firstSeenAt: Date
  lastSeenAt: Date
  platformCount: number
  signalCount: number
  recentSignalCount: number
  previousSignalCount: number
  now?: Date
}): { score: number; confidence: number; stage: TrendStage; growthPercent: number | null } {
  const now = input.now ?? new Date()
  const ageHours = Math.max(0, (now.getTime() - input.firstSeenAt.getTime()) / 3_600_000)
  const spanHours = Math.max(0, (input.lastSeenAt.getTime() - input.firstSeenAt.getTime()) / 3_600_000)
  const freshness = ageHours <= 24 ? 20 : ageHours <= 72 ? 12 : ageHours <= 168 ? 6 : 0
  const crossPlatform = input.platformCount >= 3 ? 30 : input.platformCount === 2 ? 22 : 8
  let velocity = 0
  if (input.previousSignalCount === 0) {
    velocity = input.recentSignalCount >= 5 ? 25 : input.recentSignalCount >= 2 ? 18 : input.recentSignalCount === 1 ? 8 : 0
  } else if (input.recentSignalCount > input.previousSignalCount) {
    velocity = Math.min(25, 8 + (input.recentSignalCount - input.previousSignalCount) * 4)
  }
  const volume = Math.min(15, Math.max(0, input.signalCount) * 3)
  const persistence = spanHours >= 168 ? 10 : spanHours >= 72 ? 6 : 0
  const score = Math.min(100, Math.max(0, freshness + crossPlatform + velocity + volume + persistence))
  const confidence = Math.min(100, Math.max(0, input.signalCount * 8 + input.platformCount * 15))
  const growthPercent = input.previousSignalCount === 0
    ? (input.recentSignalCount > 0 ? 100 : null)
    : Math.round(((input.recentSignalCount - input.previousSignalCount) / input.previousSignalCount) * 10_000) / 100
  const lastSeenAgeHours = Math.max(0, (now.getTime() - input.lastSeenAt.getTime()) / 3_600_000)
  const stage: TrendStage = score >= 70 && input.recentSignalCount >= 3
    ? 'hot'
    : score >= 45 && input.recentSignalCount > input.previousSignalCount
      ? 'warming'
      : ageHours <= 24
        ? 'new'
        : spanHours >= 72 && lastSeenAgeHours <= 48
          ? 'persistent'
          : 'cooling'
  return { score, confidence, stage, growthPercent }
}

export function parseTrendSignalInput(platform: TrendPlatform, value: unknown): TrendSignalInput | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = value as Record<string, unknown>
  const externalId = cleanTrendText(raw.externalId, 200)
  const sourceUrl = normalizeTrendSourceUrl(platform, cleanTrendText(raw.sourceUrl, 1000))
  const title = cleanTrendText(raw.title, 500)
  const excerpt = cleanTrendText(raw.excerpt, 1000) || null
  const queryTerm = cleanTrendText(raw.queryTerm, 80) || null
  const collectedAt = cleanTrendText(raw.collectedAt, 40)
  const publishedAt = cleanTrendText(raw.publishedAt, 40) || null
  if (!externalId || title.length < 2 || !sourceUrl) return null
  if (!Number.isFinite(Date.parse(collectedAt))) return null
  if (publishedAt && !Number.isFinite(Date.parse(publishedAt))) return null

  const tags = Array.isArray(raw.tags)
    ? raw.tags.map(value => cleanTrendText(value, 40)).filter(Boolean).slice(0, 20)
    : []
  const suppliedTerms = Array.isArray(raw.candidateTerms)
    ? raw.candidateTerms.filter((term): term is string => typeof term === 'string').slice(0, 20)
    : []
  const candidateTerms = extractCandidateTerms(title, [...tags, ...suppliedTerms])

  return {
    externalId,
    sourceUrl,
    title,
    excerpt,
    tags,
    candidateTerms,
    queryTerm,
    publishedAt,
    collectedAt: new Date(collectedAt).toISOString(),
    metrics: cleanTrendMetrics(raw.metrics),
  }
}
