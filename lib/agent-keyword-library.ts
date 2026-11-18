import { timingSafeEqual } from 'node:crypto'

// 词库补充取词接口（负责人 2026-11-18）：奇心 Agent 服务器每小时取一次「已确认」的游戏和应用词，按搜索量从高到低。
// 只读；不分站点，也不看站点补充状态；只返回词、分类、子类和搜索量；用专用密钥认证，不使用登录会话。
const headers = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' }
const CATEGORY_TYPE = { 游戏: 'game', 应用: 'app' } as const
type Category = keyof typeof CATEGORY_TYPE

export type KeywordLibraryWord = {
  keyword: string
  contentType: 'game' | 'app'
  category: Category
  subcategory: string | null
  volume: number | null
}
type KeywordLibraryQuery = {
  eq(column: string, value: string): KeywordLibraryQuery
  in(column: string, values: string[]): KeywordLibraryQuery
  order(column: string, options: { ascending: boolean; nullsFirst?: boolean }): KeywordLibraryQuery
  range(from: number, to: number): PromiseLike<{ data: unknown[] | null; count: number | null; error: unknown }>
}
export type KeywordLibraryService = {
  from(table: string): { select(columns: string, options: { count: 'exact' }): KeywordLibraryQuery }
}

const MAX_LIMIT = 500
const MAX_OFFSET = 200_000

function safeEqual(actual: string, expected: string): boolean {
  const a = Buffer.from(actual)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}
function integerParam(value: string | null, fallback: number, minimum: number, maximum: number): number {
  const parsed = Number.parseInt(value ?? '', 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(maximum, Math.max(minimum, parsed))
}

// category：游戏 / game、应用 / app，不写或 all 就是两类都要。其他值算无效。
export function parseKeywordLibraryQuery(url: URL): { categories: Category[]; limit: number; offset: number } | null {
  const raw = (url.searchParams.get('category') ?? '').trim()
  let categories: Category[]
  if (raw === '' || raw === 'all') categories = ['游戏', '应用']
  else if (raw === '游戏' || raw === 'game') categories = ['游戏']
  else if (raw === '应用' || raw === 'app') categories = ['应用']
  else return null
  return {
    categories,
    limit: integerParam(url.searchParams.get('limit'), 200, 1, MAX_LIMIT),
    offset: integerParam(url.searchParams.get('offset'), 0, 0, MAX_OFFSET),
  }
}

function toWord(row: unknown): KeywordLibraryWord | null {
  if (!row || typeof row !== 'object') return null
  const item = row as Record<string, unknown>
  const keyword = typeof item.keyword === 'string' ? item.keyword.trim() : ''
  const category = item.content_category
  if (!keyword || keyword.length > 100 || /[\u0000-\u001f<>]/.test(keyword)) return null
  if (category !== '游戏' && category !== '应用') return null
  const volume = typeof item.volume === 'number' && Number.isFinite(item.volume) ? item.volume : null
  const subcategory = typeof item.content_subcategory === 'string' && item.content_subcategory.trim() ? item.content_subcategory.trim() : null
  return { keyword, contentType: CATEGORY_TYPE[category], category, subcategory, volume }
}

// getKeys：允许的密钥（专用密钥，或已有的推荐词密钥），任何一个对得上就行；没有一个配置好（至少 24 位）接口就关闭。
export function createKeywordLibraryHandler(deps: { getService: () => KeywordLibraryService; getKeys: () => (string | undefined)[] }) {
  return async function GET(request: Request) {
    const expected = deps.getKeys().map(key => (key ?? '').trim()).filter(key => key.length >= 24)
    if (expected.length === 0) return Response.json({ error: '词库补充取词密钥尚未配置' }, { status: 503, headers })
    const authorization = request.headers.get('authorization') ?? ''
    const actual = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : ''
    // 每个密钥都比一遍（不提前退出），耗时和对上哪个无关。
    const matched = expected.map(key => safeEqual(actual, key)).some(Boolean)
    if (!matched) return Response.json({ error: '词库补充取词认证失败' }, { status: 401, headers })

    const query = parseKeywordLibraryQuery(new URL(request.url))
    if (!query) return Response.json({ error: '分类只能是 游戏、应用 或不填' }, { status: 400, headers })

    try {
      // 已确认分类的游戏和应用词，按搜索量从高到低；搜索量相同按关键词排，翻页顺序稳定。不分站点，不看补充状态。
      const result = await deps.getService().from('keyword_volume')
        .select('keyword, volume, content_category, content_subcategory', { count: 'exact' })
        .eq('classification_status', 'confirmed')
        .in('content_category', query.categories)
        .order('volume', { ascending: false, nullsFirst: false })
        .order('keyword', { ascending: true })
        .range(query.offset, query.offset + query.limit - 1)
      if (result.error) return Response.json({ error: '词库补充读取失败，请稍后重试' }, { status: 503, headers })
      const words = (result.data ?? []).map(toWord).filter((word): word is KeywordLibraryWord => word !== null)
      return Response.json({ words, total: result.count ?? 0, offset: query.offset, limit: query.limit, order: 'volume_desc' }, { headers })
    } catch {
      return Response.json({ error: '词库补充读取失败，请稍后重试' }, { status: 503, headers })
    }
  }
}
