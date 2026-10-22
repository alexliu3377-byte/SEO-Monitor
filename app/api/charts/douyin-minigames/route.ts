import { NextResponse } from 'next/server'
import { getTrendCaller } from '@/lib/trend-discovery-server'
import { DOUYIN_MINIGAME_SOURCE_URL, MINIGAME_BOARDS } from '@/lib/douyin-minigames'

// Cache-only reads: opening, filtering, paging, and retrying never visit Douyin.
export async function GET(request: Request) {
  const { caller, service } = await getTrendCaller()
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const params = new URL(request.url).searchParams
  const board = params.get('board') || 'new'
  const page = Number(params.get('page') || '1')
  if (!(MINIGAME_BOARDS as readonly string[]).includes(board) || !Number.isInteger(page) || page < 1 || page > 5) {
    return NextResponse.json({ error: '榜单或页码无效' }, { status: 400 })
  }
  const { data, error } = await service.rpc('get_douyin_minigame_page', { p_board: board, p_page: page })
  if (error) return NextResponse.json({ error: '小游戏榜单暂时无法读取，请稍后重试' }, { status: 503 })
  return NextResponse.json({ ...data,
    sourceUrl: DOUYIN_MINIGAME_SOURCE_URL }, { headers: { 'Cache-Control': 'private, max-age=30' } })
}
