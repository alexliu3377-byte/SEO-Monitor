import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase-server'
import { fetchHtmlList, fetchJsonHtmlPages, cleanTitle } from '@/lib/crawler'
import { assertSafeRemoteUrl } from '@/lib/safe-remote-url'

interface PreviewBody {
  url: string
  type: string
  titleSelector?: string
  dateSelector?: string
  enableVersionClean?: boolean
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const service = createServiceClient()
  const { data: profileData } = await service.from('user_profiles').select('role').eq('id', user.id).single()
  const profile = profileData as { role: string } | null
  if (!profile || !['admin', 'super'].includes(profile.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const body: PreviewBody = await request.json()
    const { url, titleSelector = '', dateSelector = '', enableVersionClean = false } = body

    const firstUrl = url.split('\n').map((u) => u.trim()).filter(Boolean)[0] || url
    if (!firstUrl) return NextResponse.json({ error: '缺少 URL' }, { status: 400 })
    await assertSafeRemoteUrl(firstUrl.replace('{page}', '1'))
    if (!titleSelector) return NextResponse.json({ error: '缺少标题CSS选择器' }, { status: 400 })

    let entries
    if (firstUrl.includes('{page}')) {
      // JSON-HTML API mode: fetch only page 1 for preview
      entries = await fetchJsonHtmlPages(firstUrl, titleSelector, dateSelector, undefined, '1970-01-01', 1, true)
    } else {
      entries = await fetchHtmlList(firstUrl, titleSelector, dateSelector, true)
    }
    const titles = entries.slice(0, 10).map((e) => e.title)

    const items = titles.map((original) => ({
      original,
      cleaned: cleanTitle(original, enableVersionClean),
    }))

    return NextResponse.json({ items })
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '预览失败' },
      { status: 500 }
    )
  }
}
