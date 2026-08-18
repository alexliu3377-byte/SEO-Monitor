import { NextResponse } from 'next/server'
import { unstable_cache } from 'next/cache'
import { createClient, createServiceClient } from '@/lib/supabase-server'

// 之前用路由级 `export const revalidate = 600` 想缓存10分钟，但这个handler
// 里的 auth.getUser() 要读cookie判断登录状态，Next.js会因此把这条路由判定成
// 动态路由——动态路由下 `revalidate` 这个路由级配置对整段响应不生效，实际
// 效果是每次请求都要重新跑一遍这个RPC（CROSS JOIN LATERAL，实测单次7秒+）。
// 改用 unstable_cache 单独包裹"取数据"这一步——这部分跟哪个用户请求无关
// （RPC本身不接参数、结果对所有人一样），用 Next 的 Data Cache 缓存，不受
// 外层路由动态渲染的影响。
const getWordlibWords = unstable_cache(
  async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const service = createServiceClient() as any
    const { data, error } = await service.rpc('get_wordlib_words')
    if (error) throw new Error(error.message)
    return data ?? []
  },
  ['wordlib-words'],
  { revalidate: 600 }
)

export async function GET() {
  const { data: { user } } = await createClient().auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const data = await getWordlibWords()
    return NextResponse.json({ data })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'RPC failed' }, { status: 500 })
  }
}
