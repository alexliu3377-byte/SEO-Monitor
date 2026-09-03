export const maxDuration = 30

import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase-server'
import { callGeminiJSON } from '@/lib/gemini'

export async function POST(req: Request) {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = createServiceClient() as any
  const { data: profile } = await svc.from('user_profiles').select('role').eq('id', user.id).single()
  if (!['super', 'admin'].includes(profile?.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { html } = await req.json() as { html?: string }
  if (!html || !html.trim()) return NextResponse.json({ error: '请粘贴HTML代码' }, { status: 400 })

  // Some sites' list pages are paginated via a JSON API whose response wraps an
  // HTML fragment (see fetchJsonHtmlPages in lib/crawler.ts: it reads
  // json.data.html ?? json.html and parses THAT with the exact same CSS
  // selectors as plain HTML mode — "JSON API mode" isn't real JSONPath
  // extraction, just HTML-in-JSON). If the pasted input looks like a JSON API
  // response, unwrap it here so the same selector logic below still applies.
  let effectiveHtml = html.trim()
  if (effectiveHtml.startsWith('{') || effectiveHtml.startsWith('[')) {
    try {
      const json = JSON.parse(effectiveHtml)
      const embeddedHtml = json?.data?.html ?? json?.html
      if (typeof embeddedHtml === 'string' && embeddedHtml.trim()) {
        effectiveHtml = embeddedHtml
      } else {
        return NextResponse.json({ error: '识别到粘贴的是JSON，但找不到 data.html 或 html 字段——如果你的接口返回字段名不一样，请直接把里面的HTML片段粘贴过来' }, { status: 400 })
      }
    } catch {
      // Looked like JSON but didn't parse — fall through, treat as raw HTML/text
    }
  }
  // Gemini free-tier input is generously sized, but there's no reason to ever
  // send more than a handful of example list-items — cap defensively.
  const trimmedHtml = effectiveHtml.slice(0, 20000)

  const prompt = `你是网页爬虫CSS选择器专家。用户会粘贴一段或多段网站"更新列表"页面的HTML代码片段，你需要分析HTML结构，给出CSS选择器。这些选择器会被下面这套固定的抓取逻辑使用，请严格按这个逻辑推导，不要按你自己的习惯写法：

1. title_selector：这个选择器会用 $(title_selector) 直接在整个页面里查找所有匹配元素，每一个匹配到的元素就代表列表里的"一条"。标题文字取该元素的 .text()；文章链接优先取该元素自己的 href 属性（取不到就往上找最近的 <a>，或往下找第一个 <a>）。因此 title_selector 应该尽量直接命中"包含标题文字、本身就是或包含链接"的那个元素（通常是一个带 class 的 <a> 标签，比如 a.appName 这种）。

2. date_selector：这是一个相对选择器，不需要写完整路径。抓取时会先从 title_selector 命中的元素，用 .closest('li, article, .item, tr, p, dd') 找最近的这几种标签的祖先容器；如果这几种都找不到，就退而求其次用 .closest('div').parent()。找到容器后，用 container.find(date_selector) 在容器内部查找日期元素。所以 date_selector 只需要写"日期元素相对容器的选择器"（比如 .dateUpdate、td:last-child），不要重复容器本身的层级路径。

3. url_selector（可选，允许留空字符串）：只有当 title_selector 命中的元素本身没有可用的 href 时才需要——此时会额外在同一个容器内用 container.find(url_selector) 查找链接元素。如果 title_selector 本身就是带 href 的 <a>，这里应该留空字符串。

用户可能粘贴了同一个列表里的多条样例（比如不同日期、不同内容类型如游戏/应用），目的是让你确认选择器能同时命中所有样例，而不是要求你为每种样例单独给选择器——除非样例之间的HTML结构（不是内容，是标签结构）确实不同导致必须用不同选择器，这种情况才在 notes 里说明。

以 JSON 格式返回，不要输出任何 JSON 外的文字：
{
  "title_selector": "CSS选择器字符串",
  "date_selector": "CSS选择器字符串",
  "url_selector": "CSS选择器字符串或空字符串",
  "confidence": 0-100的整数,
  "notes": "简要说明选择依据，或发现的样例间结构差异（中文，100字以内）"
}

HTML示例：
${trimmedHtml}`

  type SelectorResult = { title_selector?: string; date_selector?: string; url_selector?: string; confidence?: number; notes?: string }
  const { result: aiResult, error: aiErr } = await callGeminiJSON<SelectorResult>(prompt, { temperature: 0.2, maxOutputTokens: 1024 })

  if (!aiResult || !aiResult.title_selector) {
    return NextResponse.json({ error: aiErr || 'Gemini 未能识别出选择器，请检查粘贴的HTML是否完整' }, { status: 500 })
  }

  return NextResponse.json({
    title_selector: aiResult.title_selector ?? '',
    date_selector: aiResult.date_selector ?? '',
    url_selector: aiResult.url_selector ?? '',
    confidence: typeof aiResult.confidence === 'number' ? aiResult.confidence : null,
    notes: aiResult.notes ?? '',
  })
}
