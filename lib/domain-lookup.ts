// 站点诊断改版用——从用户自由输入的问题文本里识别域名，再去 sites 表精确匹配。
// 2026-08-27 新增，配合"站点诊断"从"先选一个站点"改成"直接问，AI自己识别问题
// 里提到了哪些站点"。

// 匹配形如 xxx.xxx 或 xxx.xxx.xxx 的域名 token（至少一个点，标签只含字母数字连字符）。
// 故意不要求 http(s):// 前缀——用户平时贴的都是裸域名（如 sj.zol.com.cn）。
const DOMAIN_TOKEN_RE = /\b[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?){1,}\b/gi

export function extractDomainTokens(text: string): string[] {
  const matches = text.match(DOMAIN_TOKEN_RE) ?? []
  const seen = new Set<string>()
  const out: string[] = []
  for (const m of matches) {
    const lower = m.toLowerCase()
    if (!seen.has(lower)) {
      seen.add(lower)
      out.push(lower)
    }
  }
  return out
}

export interface ResolvedSite {
  id: string
  domain: string
  name: string
  is_enabled: boolean
  has_rank_data: boolean
  has_rank_title: boolean
  has_index_pages: boolean
  focus_level: number
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function resolveDomains(service: any, tokens: string[]): Promise<{
  matched: ResolvedSite[]
  unmatched: string[]
}> {
  if (tokens.length === 0) return { matched: [], unmatched: [] }

  const { data } = await service
    .from('sites')
    .select('id, domain, name, is_enabled, has_rank_data, has_rank_title, has_index_pages, focus_level')
    .in('domain', tokens)
  const matched = (data ?? []) as ResolvedSite[]
  const matchedDomains = new Set(matched.map(s => s.domain.toLowerCase()))
  const unmatched = tokens.filter(t => !matchedDomains.has(t))
  return { matched, unmatched }
}
