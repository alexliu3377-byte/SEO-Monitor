// Search-volume lookup for "分发词" (admin-curated keywords handed to members
// to work on) — these are typically software/app names with a qualifier
// suffix tacked on ("Lo研社官方正版", "reWASD安卓汉化版") that was never
// itself crawled, so an exact keyword_volume lookup usually misses. Stripping
// the qualifier down to the underlying product name ("Lo研社", "reWASD") and
// searching for THAT instead recovers a real volume estimate in most cases.

// Longest-first isn't required for correctness (guessBaseKeyword loops to a
// fixed point, trying every suffix each pass) but keeps each pass doing the
// biggest possible trim.
const QUALIFIER_SUFFIXES = [
  '官方正版', '官方版', '正版', '纯净版', '安卓版', '安卓', 'ios版', '苹果版', 'ios',
  '汉化版', '中文版', '免费版', '破解版', '解锁版', '会员版', '去广告版', '最新版',
  '老版本', '网页版', 'h5版', '离线版', '不用登录', '手机版', '电脑版', 'pc版',
  'app', 'apk', '插件', '下载',
].sort((a, b) => b.length - a.length)

export function guessBaseKeyword(kw: string): string {
  let base = kw.trim()
  let changed = true
  while (changed && base.length > 1) {
    changed = false
    for (const suf of QUALIFIER_SUFFIXES) {
      if (base.length > suf.length && base.toLowerCase().endsWith(suf.toLowerCase())) {
        base = base.slice(0, base.length - suf.length).trim()
        changed = true
        break
      }
    }
  }
  return base
}

export interface VolumeLookupResult {
  volume: number
  source: 'exact' | 'base_match' | 'unknown'
  matchedKeyword: string | null
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function lookupVolumeWithFallback(service: any, keyword: string): Promise<VolumeLookupResult> {
  const { data: exact } = await service
    .from('keyword_volume').select('keyword, volume').ilike('keyword', keyword).limit(1).maybeSingle()
  if (exact && exact.volume > 0) {
    return { volume: exact.volume, source: 'exact', matchedKeyword: null }
  }

  const base = guessBaseKeyword(keyword)
  if (base && base.toLowerCase() !== keyword.toLowerCase() && base.length >= 2) {
    const { data: candidates } = await service
      .from('keyword_volume').select('keyword, volume')
      .ilike('keyword', `%${base}%`).order('volume', { ascending: false }).limit(1)
    const best = candidates?.[0]
    if (best && best.volume > 0) {
      return { volume: best.volume, source: 'base_match', matchedKeyword: best.keyword }
    }
  }

  return { volume: exact?.volume ?? 0, source: 'unknown', matchedKeyword: null }
}
