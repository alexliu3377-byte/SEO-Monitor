import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase-server'
import { getUserProfile } from '@/lib/get-user-profile'
import { assertSafeRemoteUrl } from '@/lib/safe-remote-url'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const STRING_LIMITS: Record<string, number> = {
  name: 120,
  list_url: 50_000,
  title_selector: 5_000,
  date_selector: 5_000,
  source_types: 2_000,
  url_selectors: 5_000,
}
const BOOLEAN_FIELDS = [
  'capture_source_url', 'enable_version_clean', 'is_enabled', 'has_rank_data',
  'has_rank_title', 'track_pc_rank', 'has_index_pages',
] as const

function sanitizeSitePayload(value: unknown): { data?: Record<string, unknown>; error?: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { error: '无效请求' }
  const body = value as Record<string, unknown>
  const data: Record<string, unknown> = {}

  if (typeof body.domain !== 'string') return { error: '域名不能为空' }
  const domain = body.domain.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '').replace(/\.$/, '')
  if (!/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(domain)) {
    return { error: '域名格式不正确' }
  }
  data.domain = domain

  for (const [field, limit] of Object.entries(STRING_LIMITS)) {
    if (!(field in body)) continue
    if (typeof body[field] !== 'string' || body[field].length > limit) return { error: `${field} 格式不正确` }
    data[field] = body[field].trim()
  }
  if (!data.name) data.name = domain

  if (body.category != null) {
    if (!['large', 'medium', 'small'].includes(String(body.category))) return { error: '无效站点分类' }
    data.category = body.category
  }
  if (body.focus_level != null) {
    const focusLevel = Number(body.focus_level)
    if (!Number.isInteger(focusLevel) || focusLevel < 1 || focusLevel > 3) return { error: '无效关注级别' }
    data.focus_level = focusLevel
  }
  if (body.crawl_type != null && body.crawl_type !== 'html') return { error: '无效抓取类型' }
  if (body.crawl_type === 'html') data.crawl_type = 'html'
  if (body.crawl_frequency != null && body.crawl_frequency !== 'daily') return { error: '无效抓取频率' }
  if (body.crawl_frequency === 'daily') data.crawl_frequency = 'daily'

  for (const field of BOOLEAN_FIELDS) {
    if (!(field in body)) continue
    const allowsNull = field === 'track_pc_rank'
    if (typeof body[field] !== 'boolean' && !(allowsNull && body[field] === null)) return { error: `${field} 格式不正确` }
    data[field] = body[field]
  }
  for (const field of ['version_suffixes', 'friend_links'] as const) {
    if (!(field in body)) continue
    const list = body[field]
    if (!Array.isArray(list) || list.length > 200 || list.some(item => typeof item !== 'string' || item.length > 1_000)) {
      return { error: `${field} 格式不正确` }
    }
    data[field] = [...new Set(list.map(item => item.trim()).filter(Boolean))]
  }
  return { data }
}

async function validateSiteSources(data: Record<string, unknown>): Promise<string | null> {
  const value = typeof data.list_url === 'string' ? data.list_url : ''
  const urls = value.split('|||').flatMap(block => block.split('\n')).map(item => item.trim()).filter(Boolean)
  if (urls.length > 50) return '抓取来源过多'
  try {
    await Promise.all(urls.map(url => assertSafeRemoteUrl(url.replace('{page}', '1'))))
    return null
  } catch {
    return '抓取地址必须是可公开访问的标准 HTTP/HTTPS URL'
  }
}

async function getCallerRole(): Promise<string | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = createServiceClient() as any
  const { data } = await service.from('user_profiles').select('role').eq('id', user.id).single()
  return data?.role ?? 'normal'
}

export async function GET() {
  const profile = await getUserProfile()
  if (!profile) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const supabase = createServiceClient()
    let query = supabase.from('sites').select('*').order('created_at', { ascending: false })
    // normal 角色只能看 accessibleSiteIds 范围内的站点（focus_level=3 或被
    // user_site_access 授权）——之前只在前端过滤，接口本身没做同等限制。
    if (profile.accessibleSiteIds) query = query.in('id', profile.accessibleSiteIds)
    const { data, error } = await query
    if (error) throw error
    return NextResponse.json({ sites: data })
  } catch (err: unknown) {
    console.error('Site query failed', err)
    return NextResponse.json({ error: '查询失败' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  const role = await getCallerRole()
  if (!role) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (role === 'normal') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  try {
    const body = await request.json()
    const { data: insertData, error: inputError } = sanitizeSitePayload(body)
    if (inputError || !insertData) return NextResponse.json({ error: inputError || '无效请求' }, { status: 400 })
    const sourceError = await validateSiteSources(insertData)
    if (sourceError) return NextResponse.json({ error: sourceError }, { status: 400 })

    const supabase = createServiceClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase.from('sites') as any).insert(insertData)
      .select()
      .single()
    if (error) throw error
    return NextResponse.json({ site: data }, { status: 201 })
  } catch (err: unknown) {
    console.error('Site creation failed', err)
    return NextResponse.json({ error: '创建失败' }, { status: 500 })
  }
}

export async function PUT(request: Request) {
  const role = await getCallerRole()
  if (!role) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (role === 'normal') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  try {
    const body = await request.json()
    const id = typeof body?.id === 'string' ? body.id : ''
    if (!UUID_RE.test(id)) return NextResponse.json({ error: '无效 id' }, { status: 400 })
    const { data: updateData, error: inputError } = sanitizeSitePayload(body)
    if (inputError || !updateData) return NextResponse.json({ error: inputError || '无效请求' }, { status: 400 })
    const sourceError = await validateSiteSources(updateData)
    if (sourceError) return NextResponse.json({ error: sourceError }, { status: 400 })

    const supabase = createServiceClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase.from('sites') as any).update(updateData).eq('id', id).select().single()
    if (error) throw error
    return NextResponse.json({ site: data })
  } catch (err: unknown) {
    console.error('Site update failed', err)
    return NextResponse.json({ error: '更新失败' }, { status: 500 })
  }
}

export async function DELETE(request: Request) {
  const role = await getCallerRole()
  if (!role) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (role === 'normal') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  try {
    const { id } = await request.json()
    if (typeof id !== 'string' || !UUID_RE.test(id)) return NextResponse.json({ error: '无效 id' }, { status: 400 })

    const supabase = createServiceClient()
    const { error } = await supabase.from('sites').delete().eq('id', id)
    if (error) throw error
    return NextResponse.json({ success: true })
  } catch (err: unknown) {
    console.error('Site deletion failed', err)
    return NextResponse.json({ error: '删除失败' }, { status: 500 })
  }
}
