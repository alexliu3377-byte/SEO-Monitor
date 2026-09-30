import { NextResponse } from 'next/server'
import { callGeminiJSON, QUALITY_MODELS } from '@/lib/gemini'
import { isProjectOwner } from '@/lib/project-owner'
import { createClient } from '@/lib/supabase-server'

export const maxDuration = 60

type GeneratedPage = { name: string; html: string; css: string }

export async function POST(request: Request) {
  const auth = await createClient()
  const { data: { user } } = await auth.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isProjectOwner(user.id)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await request.json().catch(() => null) as { description?: string; device?: string } | null
  const description = body?.description?.trim().slice(0, 3000) ?? ''
  const device = body?.device === 'mobile' ? '独立 M 端页面（375px）' : '独立 PC 端页面（1440px）'
  if (description.length < 10) return NextResponse.json({ error: '请至少说明页面用途、内容和想要的风格' }, { status: 400 })

  const prompt = `你是中文 SEO 网页原型设计师。请根据要求生成一个可编辑的 ${device} 初稿。

用户要求：
${description}

必须返回 JSON：{"name":"页面名称","html":"...","css":"..."}。
规则：
- 只返回语义化 HTML 与原生 CSS，不使用 JavaScript、React、外部库、iframe 或追踪代码。
- 正文必须在 main 中，只有一个 H1，图片用 img 且有有意义的 alt。
- 结构尽量分成 header/section/article/footer，方便 GrapesJS 选中和拖动。
- 文字与布局需可直接交给技术部，不写空洞占位词。
- 页面适合百度读取：核心文字直接存在 HTML，链接用普通 a href。
- CSS 使用稳定的 flex/grid，避免大量 absolute。`

  const { result, error } = await callGeminiJSON<GeneratedPage>(prompt, {
    temperature: 0.55,
    maxOutputTokens: 8192,
    models: QUALITY_MODELS,
  })
  if (!result?.html || !result?.css) return NextResponse.json({ error: error || 'AI 未能生成完整页面' }, { status: 502 })
  return NextResponse.json({ page: result })
}
