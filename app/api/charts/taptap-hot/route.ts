import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { parseTapTapPopularRankingHtml } from '@/lib/taptap-ranking'

const TAPTAP_POPULAR_URL = 'https://www.taptap.cn/top/download'
const SIX_HOURS = 21_600
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'

export async function GET() {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    // 只读取公开热门榜，并缓存 6 小时；不再通过随机关键词访问搜索结果页。
    const response = await fetch(TAPTAP_POPULAR_URL, {
      headers: {
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'zh-CN,zh;q=0.9',
        'User-Agent': UA,
      },
      next: { revalidate: SIX_HOURS },
      signal: AbortSignal.timeout(15_000),
    })
    if (!response.ok) {
      throw new Error(`TapTap 热门榜返回 HTTP ${response.status}`)
    }

    const items = parseTapTapPopularRankingHtml(await response.text())
    if (items.length === 0) throw new Error('TapTap 热门榜页面暂未解析到数据')

    return NextResponse.json({ items, sourceUrl: TAPTAP_POPULAR_URL })
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 502 })
  }
}
