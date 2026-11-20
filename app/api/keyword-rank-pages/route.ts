import { NextResponse } from 'next/server'
import { parseExportQuery, readExportPage, type ExportService } from '@/lib/keyword-rank-pages-export'
import { createClient, createServiceClient } from '@/lib/supabase-server'

export const maxDuration = 30
export const dynamic = 'force-dynamic'

// 词库补充页「导出词和链接」按页读数据（2026-11-20）。竞品站页面属于内部资料：只给管理员（和补录排名 Excel 一样，普通账号不行）。
export async function GET(request: Request) {
  const auth = await createClient()
  const { data: { user } } = await auth.auth.getUser()
  if (!user) return NextResponse.json({ error: '请先登录' }, { status: 401 })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = createServiceClient() as any
  const { data: profile } = await service.from('user_profiles').select('role, is_active').eq('id', user.id).maybeSingle()
  if (!profile || profile.is_active === false || profile.role === 'normal') {
    return NextResponse.json({ error: '只有管理员可以导出' }, { status: 403 })
  }
  try {
    const page = await readExportPage(service as ExportService, parseExportQuery(new URL(request.url)))
    return NextResponse.json(page, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch {
    return NextResponse.json({ error: '读取失败：词和链接表可能还没建好或还没刷新过' }, { status: 503 })
  }
}
