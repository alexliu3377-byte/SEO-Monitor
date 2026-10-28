import { NextResponse } from 'next/server'
import { authorizeContentCollector } from '@/lib/content-access-server'
import { createServiceClient } from '@/lib/supabase-server'
import { validateMinigameRankings } from '@/lib/douyin-minigames'

export async function POST(request: Request) {
  const authorization = authorizeContentCollector(request)
  if (!authorization.ok) return NextResponse.json({ error: '小游戏采集认证未通过' }, { status: authorization.missingConfiguration ? 503 : 401 })
  if (Number(request.headers.get('content-length')) > 500_000) return NextResponse.json({ error: '资料超过大小限制' }, { status: 413 })
  let items, collectedAt
  try {
    const raw = await request.text()
    if (new TextEncoder().encode(raw).length > 500_000) return NextResponse.json({ error: '资料超过大小限制' }, { status: 413 })
    const body = JSON.parse(raw)
    collectedAt = body.collectedAt
    if (typeof collectedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(collectedAt)
      || !Number.isFinite(Date.parse(collectedAt)) || Date.parse(collectedAt) > Date.now() + 300_000) throw new Error('采集时间无效')
    items = validateMinigameRankings(body.items)
  } catch { return NextResponse.json({ error: '小游戏榜单资料无效或不完整' }, { status: 400 }) }
  const service = createServiceClient() as any
  const { data, error } = await service.rpc('replace_douyin_minigame_rankings', { p_collected_at: collectedAt, p_items: items })
  if (error) return NextResponse.json({ error: '小游戏资料保存失败，未替换已有资料' }, { status: 500 })
  return NextResponse.json({ accepted: data, ignored: data === 0 })
}
