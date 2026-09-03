import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase-server'

async function requireAdmin() {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = createServiceClient() as any
  const { data: profile } = await service.from('user_profiles').select('role').eq('id', user.id).single()
  if (!['super', 'admin'].includes(profile?.role)) return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  return { user, service }
}

// 同一行内允许贴多个别名（同一个商业概念的不同叫法，比如"纸飞机、telegram、
// telegreat"）——用顿号/逗号/中文逗号分隔。2026-08-28 加入：用户反馈这种
// 多别名场景很常见，一开始只支持"一行一个独立词"导致贴进来的多别名行被
// 整行存成一个不成词的字符串（比如"纸飞机telegram"）。
const GROUP_SEPARATOR_RE = /[、,，]+/

function parseLine(line: string): string[] {
  return line.split(GROUP_SEPARATOR_RE).map(s => s.trim()).filter(Boolean)
}

// 研究中心"商业词"tab 的种子清单——贴一份固定名单维护（不含下拉词挖出来的
// 变体，那部分现查现用不落库，见 coverage/route.ts）。同一个 group_name 下的
// 几个词是同一个商业概念的不同别名，查覆盖时会归拢在一起展示。2026-08-28 新增。
export async function GET() {
  const ctx = await requireAdmin()
  if (ctx.error) return ctx.error
  const { service } = ctx

  const { data, error } = await service
    .from('commercial_keywords')
    .select('id, keyword, group_name, created_at')
    .order('created_at', { ascending: false })
  if (error) return NextResponse.json({ error: 'Internal server error' }, { status: 500 })

  return NextResponse.json({ keywords: data ?? [] })
}

export async function POST(req: Request) {
  const ctx = await requireAdmin()
  if (ctx.error) return ctx.error
  const { user, service } = ctx

  const { keywords, groupName: targetGroup } = await req.json() as { keywords?: string; groupName?: string }
  if (!keywords || !keywords.trim()) return NextResponse.json({ error: '没有输入关键词' }, { status: 400 })

  const lines = keywords.split('\n').map(l => l.trim()).filter(Boolean)
  if (lines.length === 0) return NextResponse.json({ error: '没有有效的关键词' }, { status: 400 })

  const rows: { keyword: string; group_name: string; added_by: string }[] = []
  const seen = new Set<string>()

  if (targetGroup && targetGroup.trim()) {
    // 词组详情页"内联加别名"用这条路径——传了 groupName 就不按"每行一组"解析，
    // 整段文本拆出来的全部词都当成加进这一个已有组的新别名。
    for (const line of lines) {
      for (const keyword of parseLine(line)) {
        if (seen.has(keyword)) continue
        seen.add(keyword)
        rows.push({ keyword, group_name: targetGroup.trim(), added_by: user.id })
      }
    }
  } else {
    // 每一行是一组别名——group_name 用这一行第一个词当标签；同一行多个别名
    // 各自存一行，但共享同一个 group_name。
    for (const line of lines) {
      const members = parseLine(line)
      if (members.length === 0) continue
      const groupName = members[0]
      for (const keyword of members) {
        if (seen.has(keyword)) continue
        seen.add(keyword)
        rows.push({ keyword, group_name: groupName, added_by: user.id })
      }
    }
  }
  if (rows.length === 0) return NextResponse.json({ error: '没有有效的关键词' }, { status: 400 })
  // 上限比分组任务"分发词"的200更低——每个词后面都要接一次下拉词API调用+
  // 排名查询，控制单次"查覆盖"的耗时和对百度接口的压力。
  if (rows.length > 100) return NextResponse.json({ error: '一次最多添加100个词（含别名展开后）' }, { status: 400 })

  const { data: inserted, error } = await service
    .from('commercial_keywords')
    .upsert(rows, { onConflict: 'keyword', ignoreDuplicates: true })
    .select('id, keyword, group_name, created_at')
  if (error) return NextResponse.json({ error: 'Internal server error' }, { status: 500 })

  return NextResponse.json({ keywords: inserted })
}

// 词组详情页标题行内改名用——已存在但还没审核、group_name等于旧名字的
// "新词发现"候选不做级联改名（会变成一条指向旧名字的候选，用户审核时
// "加入词组"表单本来就能手动改归属组名，不影响功能，只是标签显示旧名，
// 刻意简化不做级联更新）。
export async function PATCH(req: Request) {
  const ctx = await requireAdmin()
  if (ctx.error) return ctx.error
  const { service } = ctx

  const { groupName, newGroupName } = await req.json() as { groupName?: string; newGroupName?: string }
  if (!groupName || !newGroupName || !newGroupName.trim()) return NextResponse.json({ error: '缺少参数' }, { status: 400 })

  const { error } = await service.from('commercial_keywords')
    .update({ group_name: newGroupName.trim() })
    .eq('group_name', groupName)
  if (error) return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: Request) {
  const ctx = await requireAdmin()
  if (ctx.error) return ctx.error
  const { service } = ctx

  const { id, all, groupName } = await req.json() as { id?: string; all?: boolean; groupName?: string }
  if (all) {
    const { error } = await service.from('commercial_keywords').delete().not('id', 'is', null)
    if (error) return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    return NextResponse.json({ ok: true })
  }
  if (groupName) {
    const { error } = await service.from('commercial_keywords').delete().eq('group_name', groupName)
    if (error) return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    return NextResponse.json({ ok: true })
  }
  if (!id) return NextResponse.json({ error: '缺少 id' }, { status: 400 })
  const { error } = await service.from('commercial_keywords').delete().eq('id', id)
  if (error) return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  return NextResponse.json({ ok: true })
}
