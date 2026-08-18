import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'

type HotItem = { rank: number; name: string; labels: string[] }

export async function GET() {
  // 跟 monthly-trend 同一个门槛——登录即可查，不限 super/admin。之前这里
  // 完全没做校验，无鉴权无限流地代理抓取第三方站点。
  const authClient = createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const res = await fetch('https://www.taptap.cn/top/download', {
      headers: {
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'zh-CN,zh;q=0.9',
        'User-Agent': UA,
      },
      next: { revalidate: 1800 },
    })

    const html = await res.text()

    // --- Step 1: rendered anchors (server-renders ~9 items) ---
    // Gives correct keywords including ASCII names like Phigros, plus label badges.
    const renderedItems: HotItem[] = []
    const anchorRe =
      /class="[^"]*tap-hot-search-item__wrapper[^"]*"[^>]+href="\/search\/([^"?]+)|href="\/search\/([^"?]+)"[^>]*class="[^"]*tap-hot-search-item__wrapper/g
    let m: RegExpExecArray | null
    while ((m = anchorRe.exec(html)) !== null) {
      if (renderedItems.length >= 20) break
      const encoded = m[1] ?? m[2]
      if (!encoded) continue
      const keyword = decodeURIComponent(encoded)
      const anchorStart = html.lastIndexOf('<a ', m.index)
      const anchorEnd = html.indexOf('</a>', m.index) + 4
      const anchorHtml = anchorStart >= 0 && anchorEnd > anchorStart ? html.slice(anchorStart, anchorEnd) : ''
      const labels: string[] = []
      if (/活动/.test(anchorHtml)) labels.push('活动')
      if (/首发/.test(anchorHtml)) labels.push('首发')
      if (/UP/.test(anchorHtml)) labels.push('上升')
      renderedItems.push({ rank: renderedItems.length + 1, name: keyword, labels })
    }

    // --- Step 2: serialized data chunk (all 20 items, but item 1 extracts '热搜' so skip it) ---
    // The page embeds a flat Vuex store with service= URLs as delimiters between items.
    // Taking the last non-ASCII quoted string between consecutive service= URLs gives the keyword.
    const serializedItems: string[] = [] // index i → rank (i+1)
    const hotIdx = html.indexOf('"hot_search"')
    if (hotIdx >= 0) {
      const chunk = html.slice(hotIdx, hotIdx + 8000)
      const svcRe = /"service=[^"]*scenes=[^"]*"/g
      const svcMatches: RegExpExecArray[] = []
      let sm: RegExpExecArray | null
      while ((sm = svcRe.exec(chunk)) !== null) svcMatches.push(sm)

      for (let i = 0; i < svcMatches.length && i < 20; i++) {
        const segStart = i === 0 ? 0 : svcMatches[i - 1].index + svcMatches[i - 1][0].length
        const segEnd = svcMatches[i].index
        const segment = chunk.slice(segStart, segEnd)
        const allQuoted = Array.from(segment.matchAll(/"([^"]+)"/g)).map((q) => q[1])
        // Last string with a non-ASCII character is the keyword (title/display_word precedes service= URL)
        const keyword = allQuoted.reverse().find((s) => /[^\x00-\x7F]/.test(s)) ?? ''
        serializedItems.push(keyword)
      }
    }

    // --- Step 3: merge — rendered wins for ranks it covers, serialized fills the rest ---
    const items: HotItem[] = []
    for (let rank = 1; rank <= 20; rank++) {
      const rendered = renderedItems[rank - 1]
      const serialized = serializedItems[rank - 1]
      if (rendered) {
        items.push(rendered)
      } else if (serialized) {
        items.push({ rank, name: serialized, labels: [] })
      }
    }

    return NextResponse.json({ items })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
