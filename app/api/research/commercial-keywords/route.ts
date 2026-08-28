import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase-server'

async function requireAdmin() {
  const authClient = createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = createServiceClient() as any
  const { data: profile } = await service.from('user_profiles').select('role').eq('id', user.id).single()
  if (!['super', 'admin'].includes(profile?.role)) return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  return { user, service }
}

// 研究中心"商业词"tab 的种子清单——贴一份固定名单维护（不含下拉词挖出来的
// 变体，那部分现查现用不落库，见 coverage/route.ts）。2026-08-28 新增。
export async function GET() {
  const ctx = await requireAdmin()
  if (ctx.error) return ctx.error
  const { service } = ctx

  const { data, error } = await service
    .from('commercial_keywords')
    .select('id, keyword, created_at')
    .order('created_at', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ keywords: data ?? [] })
}

export async function POST(req: Request) {
  const ctx = await requireAdmin()
  if (ctx.error) return ctx.error
  const { user, service } = ctx

  const { keywords } = await req.json() as { keywords?: string }
  if (!keywords || !keywords.trim()) return NextResponse.json({ error: '没有输入关键词' }, { status: 400 })

  const list = Array.from(new Set(
    keywords.split('\n').map(k => k.trim()).filter(Boolean)
  ))
  if (list.length === 0) return NextResponse.json({ error: '没有有效的关键词' }, { status: 400 })
  // 上限比分组任务"分发词"的200更低——每个词后面都要接一次下拉词API调用+
  // 排名查询，控制单次"查覆盖"的耗时和对百度接口的压力。
  if (list.length > 100) return NextResponse.json({ error: '一次最多添加100个词' }, { status: 400 })

  const rows = list.map(keyword => ({ keyword, added_by: user.id }))
  const { data: inserted, error } = await service
    .from('commercial_keywords')
    .upsert(rows, { onConflict: 'keyword', ignoreDuplicates: true })
    .select('id, keyword, created_at')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ keywords: inserted })
}

export async function DELETE(req: Request) {
  const ctx = await requireAdmin()
  if (ctx.error) return ctx.error
  const { service } = ctx

  const { id, all } = await req.json() as { id?: string; all?: boolean }
  if (all) {
    const { error } = await service.from('commercial_keywords').delete().not('id', 'is', null)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }
  if (!id) return NextResponse.json({ error: '缺少 id' }, { status: 400 })
  const { error } = await service.from('commercial_keywords').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
