import { NextResponse } from 'next/server'
import { isProjectOwner } from '@/lib/project-owner'
import {
  isKeywordPrimaryCategory,
  isValidKeywordSubcategory,
  type KeywordClassificationStatus,
} from '@/lib/keyword-classification'
import { createClient, createServiceClient } from '@/lib/supabase-server'

const STATUSES: KeywordClassificationStatus[] = ['pending', 'confirmed']

async function requireOwner() {
  const auth = await createClient()
  const { data: { user } } = await auth.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  if (!isProjectOwner(user.id)) return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  return { service: createServiceClient() }
}

export async function GET(request: Request) {
  const access = await requireOwner()
  if ('error' in access) return access.error

  const { searchParams } = new URL(request.url)
  const page = Math.max(0, Number.parseInt(searchParams.get('page') || '0', 10) || 0)
  const pageSize = Math.min(100, Math.max(20, Number.parseInt(searchParams.get('pageSize') || '50', 10) || 50))
  const status = searchParams.get('status') || 'pending'
  const category = searchParams.get('category') || ''
  const subcategory = searchParams.get('subcategory') || ''
  const search = (searchParams.get('q') || '').trim().slice(0, 100)

  // The checked-in database type is intentionally partial; this migration is
  // newer than that historical snapshot.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = access.service as any
  let query = service.from('keyword_volume')
    .select('keyword, volume, volume_change, net_volume_change, stat_date, content_category, content_subcategory, classification_status, classification_source, classification_confidence, classification_reason, classification_queued_at, classified_at, reviewed_at', { count: 'exact' })

  if (STATUSES.includes(status as KeywordClassificationStatus)) query = query.eq('classification_status', status)
  if (category) query = category === '待分类'
    ? query.eq('classification_status', 'pending')
    : query.eq('content_category', category)
  if (subcategory) query = query.eq('content_subcategory', subcategory)
  if (search) query = query.ilike('keyword', `%${search}%`)

  query = status === 'pending'
    ? query.order('classification_queued_at', { ascending: false }).order('volume', { ascending: false })
    : query.order('volume', { ascending: false }).order('keyword', { ascending: true })

  const from = page * pageSize
  const [{ data, count, error }, summaryResult, batchResult] = await Promise.all([
    query.range(from, from + pageSize - 1),
    service.rpc('keyword_classification_summary'),
    service.from('keyword_classification_batches')
      .select('id, status, requested_count, saved_count, model, error_message, started_at, completed_at')
      .order('started_at', { ascending: false })
      .limit(5),
  ])

  if (error || summaryResult.error || batchResult.error) {
    console.error('Keyword classification load failed:', error?.message || summaryResult.error?.message || batchResult.error?.message)
    return NextResponse.json({ error: '分类资料尚未建立或读取失败' }, { status: 500 })
  }

  return NextResponse.json({ items: data ?? [], total: count ?? 0, summary: summaryResult.data ?? [], batches: batchResult.data ?? [] })
}

export async function PATCH(request: Request) {
  const access = await requireOwner()
  if ('error' in access) return access.error
  const body = await request.json().catch(() => null) as {
    keyword?: unknown
    category?: unknown
    subcategory?: unknown
  } | null
  const keyword = typeof body?.keyword === 'string' ? body.keyword.trim() : ''
  if (!keyword || !isKeywordPrimaryCategory(body?.category)) {
    return NextResponse.json({ error: '关键词或一级分类无效' }, { status: 400 })
  }
  const category = body.category
  const subcategory = typeof body?.subcategory === 'string' ? body.subcategory.trim() : ''
  if (!isValidKeywordSubcategory(category, subcategory)) {
    return NextResponse.json({ error: category === '游戏' || category === '应用' ? '请选择有效的二级分类' : '该一级分类不应设置二级分类' }, { status: 400 })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = access.service as any
  const { error } = await service.from('keyword_volume').update({
    content_category: category,
    content_subcategory: subcategory || null,
    classification_status: 'confirmed',
    classification_source: 'manual',
    classification_confidence: 1,
    classification_reason: '人工修改',
    reviewed_at: new Date().toISOString(),
  }).eq('keyword', keyword)
  if (error) return NextResponse.json({ error: '保存分类失败' }, { status: 500 })
  return NextResponse.json({ ok: true })
}
