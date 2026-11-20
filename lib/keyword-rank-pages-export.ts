// 词库补充页「导出词和链接」（2026-11-20，负责人要求）：从提前算好的表 keyword_rank_pages 按页读，
// 浏览器里一页页读完再拼成文件下载（几万个词一次返回会超过线上接口的大小和时间限制）。文件格式在 keyword-rank-pages-csv.ts。
// 搜索量只用来筛（默认 1000 以下，含 1000），不导出。
import { storedPages } from './agent-ranked-pages'
import type { ExportRow } from './keyword-rank-pages-csv'

export const EXPORT_PAGE_SIZE = 2000
export type ExportPage = { rows: ExportRow[]; offset: number; nextOffset: number; end: boolean; total: number; maxVolume: number; refreshedAt: string | null }

type Query = PromiseLike<{ data: unknown[] | null; count?: number | null; error: unknown }> & {
  gt(column: string, value: unknown): Query
  lte(column: string, value: unknown): Query
  order(column: string, options: { ascending: boolean; nullsFirst?: boolean }): Query
  range(from: number, to: number): Query
}
export type ExportService = { from(table: string): { select(columns: string, options?: { count: 'exact' }): Query } }

const int = (value: string | null, fallback: number, min: number, max: number) => {
  const n = Number.parseInt(value ?? '', 10)
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback
}
export function parseExportQuery(url: URL) {
  return {
    offset: int(url.searchParams.get('offset'), 0, 0, 1_000_000),
    limit: int(url.searchParams.get('limit'), EXPORT_PAGE_SIZE, 1, EXPORT_PAGE_SIZE),
    maxVolume: int(url.searchParams.get('maxVolume'), 1000, 1, 100_000),
  }
}

export async function readExportPage(service: ExportService, query: ReturnType<typeof parseExportQuery>): Promise<ExportPage> {
  // 按词排（不按搜索量），导出的文件里不出现搜索量；offset 翻页，表不大（几万行）。
  const r = await service.from('keyword_rank_pages')
    .select('keyword, content_category, content_subcategory, pages, refreshed_at', { count: 'exact' })
    .gt('volume', 0)
    .lte('volume', query.maxVolume)
    .order('content_category', { ascending: true })
    .order('keyword', { ascending: true })
    .range(query.offset, query.offset + query.limit - 1)
  if (r.error) throw new Error('export_read_failed')
  const data = (r.data ?? []) as Record<string, unknown>[]
  let refreshedAt: string | null = null
  const rows: ExportRow[] = data.flatMap(row => {
    const keyword = typeof row.keyword === 'string' ? row.keyword : ''
    const category = row.content_category
    if (!keyword || (category !== '游戏' && category !== '应用')) return []
    if (typeof row.refreshed_at === 'string' && (!refreshedAt || row.refreshed_at > refreshedAt)) refreshedAt = row.refreshed_at
    const pages = storedPages(row.pages).slice(0, 5).map(p => ({ url: p.url, title: p.title }))
    const subcategory = typeof row.content_subcategory === 'string' && row.content_subcategory.trim() ? row.content_subcategory.trim() : null
    return [{ keyword, category, subcategory, pageCount: pages.length, pages }]
  })
  return { rows, offset: query.offset, nextOffset: query.offset + data.length, end: data.length < query.limit, total: r.count ?? 0, maxVolume: query.maxVolume, refreshedAt }
}
