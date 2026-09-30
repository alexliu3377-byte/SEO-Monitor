'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'

type Lesson = {
  id: string
  number: string
  title: string
  duration: string
  goal: string
  steps: string[]
  assignment: string
  done: string[]
}

const LESSONS: Lesson[] = [
  {
    id: 'lesson-0', number: '00', title: '先把 Figma 操作顺手', duration: '30 分钟',
    goal: '先学会移动画布、缩放、选择和进入图层，不让基础操作打断设计思路。',
    steps: ['按住鼠标滚轮（中键）并拖动：向任意方向平移画布。', '没有中键时，按住空格再用鼠标左键拖动，也能平移画布。', '滚动滚轮可上下移动；按住 Shift 再滚动可横向移动；Ctrl/⌘ + 滚轮可缩放。', '按 F 快速创建 Frame；按 V 回到选择工具；按住 Alt/Option 拖动可复制。', '双击进入组或组件内部；按 Enter 逐层进入，按 Shift + Enter 返回上一层。', '练习目标：不用寻找工具栏，就能在三个画板之间移动、缩放并选中指定文字。'],
    assignment: '新建三个相隔较远的 Frame，分别放入标题和按钮；只用快捷操作在三者之间移动、缩放、复制和选中内容。',
    done: ['会用中键或空格平移', '会快速缩放与定位', '会进入和退出图层'],
  },
  {
    id: 'lesson-1', number: '01', title: '先读懂旧 UI 文件', duration: '45 分钟',
    goal: '看懂你截图里的布局：上方是组件和素材区，下方才是首页、列表页、详情页。',
    steps: ['复制旧文件作为练习稿，不直接改原稿。', '建立页面：00 封面、01 基础规范、02 组件、03 页面模板、10 正式页面、90 归档。', '给现有画板重新命名：首页、游戏列表、游戏详情、文章详情等。', '把重复出现的导航、卡片、列表行、Footer 标记出来，先不要急着改颜色。'],
    assignment: '在旧稿副本中整理页面名称，并列出至少 10 个重复模块。',
    done: ['原稿有备份', '页面命名看得懂', '找出重复模块'],
  },
  {
    id: 'lesson-2', number: '02', title: '抓参考页面，但不整页照搬', duration: '60 分钟',
    goal: '从竞品或优秀页面提取“做法”，而不是复制它的品牌、图片和全部版式。',
    steps: ['截取公开页面作为 Reference，只放在参考区，不直接当正式设计。', '分别标记：导航高度、内容宽度、列数、卡片间距、字体层级、颜色和 Hover。', '每个参考页面只选 1–2 个值得借鉴的点，例如导航密度或排行榜样式。', '记录为什么采用：提高首屏信息量、减少留白、方便扫描，而不是“看起来不错”。'],
    assignment: '选择 3 个参考网站，每个网站写下 2 个可借鉴点和 1 个不能照搬的点。',
    done: ['参考图集中存放', '写清借鉴理由', '没有复制品牌资产'],
  },
  {
    id: 'lesson-3', number: '03', title: '建立基础规范 Foundations', duration: '75 分钟',
    goal: '先固定全站会反复使用的颜色、文字、间距、圆角和阴影。',
    steps: ['颜色只先建 6 类：品牌色、文字主色、文字次色、背景、边框、危险色。', '文字先建 5 级：页面标题、区块标题、卡片标题、正文、辅助文字。', '间距使用 4/8 体系：4、8、12、16、24、32、48。', '圆角先限制为 4、8、12、999；阴影只准备轻、重两档。', '在 Figma Variables 或 Styles 中保存这些值，避免每次手填不同颜色。'],
    assignment: '完成一张“基础规范”画板，并删除重复或接近但不一致的颜色。',
    done: ['颜色不超过必要数量', '文字有明确层级', '间距使用统一刻度'],
  },
  {
    id: 'lesson-4', number: '04', title: '先做最小组件库', duration: '2 小时',
    goal: '完成下载站第一批真正会重复使用的组件。',
    steps: ['先做 Button、Tag、IconButton、SearchInput、NavItem。', '再做 AppIconCard、ArticleCard、RankingRow、SectionHeader、Tabs。', '最后做 Header 和 Footer 这种组合组件。', '所有组件内部优先使用 Auto Layout，不用手工摆死位置。', '组件名称按用途命名，不按颜色命名，例如 Button/Primary，而不是 Button/Blue。'],
    assignment: '完成下方组件清单中的 P0 组件，每个组件至少有 Default 和 Hover 状态。',
    done: ['组件可重复拖用', '文字变化不会撑坏', 'Default/Hover 状态齐全'],
  },
  {
    id: 'lesson-5', number: '05', title: 'Auto Layout：让组件不会一改就散', duration: '90 分钟',
    goal: '掌握设计网页最重要的布局能力：内容变化时仍保持对齐和间距。',
    steps: ['选中一组元素，按 Shift + A 建立 Auto Layout。', '横向用于导航、标签和按钮组；纵向用于卡片正文和列表。', '内容尺寸优先使用 Hug contents，需要占满剩余空间时使用 Fill container。', '把 padding 和 gap 写成统一数值，不用拖动鼠标凭感觉留空。', '拉宽和缩窄组件，测试文字变长、图片缺失时是否仍然正常。'],
    assignment: '把 SearchInput、AppIconCard、RankingRow 和 Header 全部改成可伸缩布局。',
    done: ['使用 Auto Layout', '长文字测试通过', '宽度变化不重叠'],
  },
  {
    id: 'lesson-6', number: '06', title: 'Variants：管理 Hover 和不同状态', duration: '75 分钟',
    goal: '不用复制一堆散乱组件，统一管理普通、悬停、选中和禁用状态。',
    steps: ['给按钮建立 State：Default、Hover、Pressed、Disabled。', '给导航建立 State：Default、Hover、Active。', '给卡片建立 State：Default、Hover；Hover 只做必要变化。', '把 Size 和 State 分开定义，例如 Size=Medium、State=Hover。', '图标种类不要全部做成一个巨大 Variant；不同图标应是独立组件。'],
    assignment: '完成 Button、NavItem、Tag、Card 的状态变体，并在实例中切换测试。',
    done: ['状态名称统一', '没有重复散件', 'Hover 不造成布局跳动'],
  },
  {
    id: 'lesson-7', number: '07', title: '用组件拼出首页', duration: '2 小时',
    goal: '像搭积木一样完成首页，而不是重新画一遍已有元素。',
    steps: ['新建 1440px Frame，内容容器先用 1200px。', '拖入 Header 实例，再拖入推荐区、内容列表、排行榜和 Footer。', '优先调整父容器的 gap 和 padding，不逐个移动子元素。', '首屏检查：导航、搜索和第一块主要内容是否在合理高度内出现。', '替换组件实例中的文字和图片，不 Detach 组件。'],
    assignment: '用组件实例重新搭一版怀旧下载站首页，并与旧首页并排比较。',
    done: ['页面主要区域都来自组件', '首屏没有浪费空间', '没有无理由 Detach'],
  },
  {
    id: 'lesson-8', number: '08', title: '扩展列表页和详情页', duration: '2 小时',
    goal: '验证组件库能否支撑更多页面，并补齐缺少的组件。',
    steps: ['先从首页复制页面骨架，只替换内容区域。', '游戏列表使用 AppIconCard 或 ListRow；详情页复用 Header、Tag、Button、RankingRow。', '遇到新需求时先判断：是组件新状态，还是全新组件。', '不要为了单个页面修改主组件到影响所有页面，必要时增加明确的 Variant。'],
    assignment: '完成游戏列表页和游戏详情页，记录新增了哪些组件或状态。',
    done: ['页面风格一致', '组件复用率高', '特殊情况有说明'],
  },
  {
    id: 'lesson-9', number: '09', title: '原型与可用性检查', duration: '60 分钟',
    goal: '让前端看懂 Hover、下拉菜单、Tab 和页面跳转，而不是只收到静态图片。',
    steps: ['为导航 Hover、按钮点击、下拉菜单和 Tab 切换添加简单 Prototype。', '只演示关键路径，不需要把整个网站做成可运行程序。', '检查颜色对比、文字是否过小、按钮是否容易点击。', '用真实长标题和缺图状态测试，不只使用最理想的内容。'],
    assignment: '做一个可以演示：首页 → 列表 → 详情的原型流程。',
    done: ['关键交互可演示', '异常内容测试过', '原型入口清楚'],
  },
  {
    id: 'lesson-10', number: '10', title: '交付给前端', duration: '60 分钟',
    goal: '让前端不需要猜你想要什么，并能把设计组件对应到代码组件。',
    steps: ['整理 Ready for dev 区，只放确认过的页面和组件。', '每个重要组件写用途、状态、尺寸和交互说明。', '统一导出 SVG 图标和必要图片；不要把文字做成图片。', '提供页面清单、组件清单、颜色和字体规范、响应式规则。', '和前端逐项确认：哪些复用、哪些响应式变化、哪些状态必须实现。'],
    assignment: '使用本课程的交付清单，完成一次模拟交付并让前端复述需求。',
    done: ['页面标记可开发', '组件有说明', '素材和响应式规则齐全'],
  },
]

const COMPONENTS = [
  ['P0', 'Button', 'Primary / Secondary；Small / Medium；Default / Hover / Disabled'],
  ['P0', 'IconButton', '搜索、刷新、返回；Default / Hover'],
  ['P0', 'NavItem', '普通、悬停、当前页；可选下拉箭头'],
  ['P0', 'SearchInput', '默认、输入中；搜索按钮与热词区域'],
  ['P0', 'Tag / Chip', '普通、热门、选中'],
  ['P0', 'SectionHeader', '标题、图标、右侧操作“换一批”'],
  ['P0', 'AppIconCard', '图标、名称；默认和 Hover'],
  ['P0', 'RankingRow', '序号、图标、名称、更新时间'],
  ['P0', 'Header', '顶部链接、Logo/搜索、主导航'],
  ['P0', 'Footer', '友情链接区、版权区'],
  ['P1', 'ArticleCard', '图片、标题、摘要、时间'],
  ['P1', 'Tabs', 'Default / Active；内容区切换'],
  ['P1', 'Breadcrumb', '首页 / 分类 / 当前页'],
  ['P1', 'DownloadPanel', '版本信息、主下载按钮、辅助信息'],
  ['P2', 'Empty / Missing image', '缺图、无内容、加载中状态'],
]

const OFFICIAL_LINKS = [
  ['Frames', 'https://help.figma.com/hc/en-us/articles/360041539473-Frames-in-Figma-Design'],
  ['Auto Layout', 'https://help.figma.com/hc/en-us/articles/360040451373-Guide-to-auto-layout'],
  ['Variants', 'https://help.figma.com/hc/en-us/articles/360056440594-Create-and-use-variants'],
  ['开发交付', 'https://help.figma.com/hc/en-us/articles/360040521453-Optimize-design-files-for-developer-handoff'],
]

export default function DesignTrainingCourse() {
  const [completed, setCompleted] = useState<string[]>([])
  useEffect(() => {
    try { setCompleted(JSON.parse(window.localStorage.getItem('qixin-design-course-progress') || '[]')) } catch { setCompleted([]) }
  }, [])
  const toggle = (id: string) => {
  }
  const progress = Math.round((completed.length / LESSONS.length) * 100)

  return (
    <div className="min-h-screen bg-slate-50 print:bg-white">
      <header className="border-b border-slate-200 bg-white px-5 py-6 sm:px-8">
        <div className="mx-auto flex max-w-[1320px] flex-wrap items-end justify-between gap-5">
          <div><p className="text-xs font-semibold text-emerald-700">奇心内部培训 · 组件优先</p><h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-950">Figma 网页设计实战课</h1><p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">从旧 UI 文件和参考网站出发，建立组件库，完成页面设计，并整理成前端能直接执行的交付资料。不要求会代码。</p></div>
          <div className="flex gap-2 print:hidden"><Link href="/page-studio" className="btn-secondary">打开页面工作室</Link><button type="button" onClick={() => window.print()} className="btn-primary">打印 / 保存 PDF</button></div>
        </div>
      </header>

      <div className="mx-auto grid max-w-[1320px] gap-6 px-4 py-6 sm:px-8 lg:grid-cols-[240px_minmax(0,1fr)]">
        <aside className="self-start lg:sticky lg:top-5 print:hidden">
          <nav aria-label="课程目录" className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <div className="border-b border-slate-100 p-4"><div className="flex items-center justify-between text-xs"><span className="font-semibold text-slate-700">学习进度</span><span className="tabular-nums text-emerald-700">{completed.length}/{LESSONS.length}</span></div><div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-emerald-500" style={{ width: `${progress}%` }} /></div></div>
            <div className="p-2">{LESSONS.map(lesson => <a key={lesson.id} href={`#${lesson.id}`} className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-xs text-slate-600 hover:bg-slate-50 hover:text-slate-900"><span className={`flex h-5 w-5 items-center justify-center rounded border text-[10px] ${completed.includes(lesson.id) ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : 'border-slate-200'}`}>{completed.includes(lesson.id) ? '✓' : lesson.number}</span><span className="truncate">{lesson.title}</span></a>)}</div>
          </nav>
        </aside>

        <main className="min-w-0 space-y-6">
          <section className="rounded-xl border border-blue-200 bg-blue-50 p-5">
            <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-semibold text-blue-700">开始前先练 10 分钟</p><h2 className="mt-1 font-semibold text-blue-950">画布操作速查</h2></div><span className="rounded-md bg-white px-2.5 py-1 text-xs text-blue-700">Windows / Mac 通用思路</span></div>
            <div className="mt-4 grid gap-2 text-sm sm:grid-cols-2 xl:grid-cols-3"><div className="rounded-lg bg-white p-3"><strong>平移画布</strong><p className="mt-1 text-xs leading-5 text-slate-600">按住鼠标中键拖动；或按住 Space + 左键拖动</p></div><div className="rounded-lg bg-white p-3"><strong>缩放画布</strong><p className="mt-1 text-xs leading-5 text-slate-600">Ctrl/⌘ + 滚轮；Shift + 1 显示全部，Shift + 2 聚焦选中</p></div><div className="rounded-lg bg-white p-3"><strong>横向移动</strong><p className="mt-1 text-xs leading-5 text-slate-600">Shift + 滚轮；触控板可直接双指移动</p></div><div className="rounded-lg bg-white p-3"><strong>选择里面一层</strong><p className="mt-1 text-xs leading-5 text-slate-600">双击进入；Enter 向内，Shift + Enter 向外</p></div><div className="rounded-lg bg-white p-3"><strong>复制元素</strong><p className="mt-1 text-xs leading-5 text-slate-600">Alt/Option + 拖动；Ctrl/⌘ + D 重复</p></div><div className="rounded-lg bg-white p-3"><strong>常用工具</strong><p className="mt-1 text-xs leading-5 text-slate-600">V 选择、F 画板、T 文字、R 矩形、Shift + A 自动布局</p></div></div>
          </section>

          <section className="rounded-xl border border-emerald-200 bg-emerald-50 p-5">
            <h2 className="font-semibold text-emerald-950">学习顺序：先组件，后页面</h2>
            <div className="mt-4 grid gap-3 text-sm sm:grid-cols-4"><div className="rounded-lg bg-white p-3"><strong>1. 拆解</strong><p className="mt-1 text-xs leading-5 text-slate-600">找出旧稿中的重复模块</p></div><div className="rounded-lg bg-white p-3"><strong>2. 规范</strong><p className="mt-1 text-xs leading-5 text-slate-600">颜色、文字、间距统一</p></div><div className="rounded-lg bg-white p-3"><strong>3. 组件</strong><p className="mt-1 text-xs leading-5 text-slate-600">做好状态和伸缩规则</p></div><div className="rounded-lg bg-white p-3"><strong>4. 组装</strong><p className="mt-1 text-xs leading-5 text-slate-600">用实例拼页面并交付</p></div></div>
          </section>

          <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <div className="border-b border-slate-100 px-5 py-4"><h2 className="font-semibold text-slate-900">下载站组件清单</h2><p className="mt-1 text-xs text-slate-500">先完成 P0，再开始正式拼页面；P1、P2 在页面需要时补充。</p></div>
            <div className="overflow-x-auto"><table className="w-full min-w-[680px] text-left text-sm"><thead className="bg-slate-50 text-xs text-slate-500"><tr><th className="w-16 px-4 py-3">优先级</th><th className="w-40 px-4 py-3">组件</th><th className="px-4 py-3">必须准备的属性和状态</th></tr></thead><tbody className="divide-y divide-slate-100">{COMPONENTS.map(row => <tr key={row[1]}><td className="px-4 py-2.5"><span className={`rounded px-1.5 py-0.5 text-xs font-semibold ${row[0] === 'P0' ? 'bg-emerald-50 text-emerald-700' : row[0] === 'P1' ? 'bg-blue-50 text-blue-700' : 'bg-slate-100 text-slate-600'}`}>{row[0]}</span></td><td className="px-4 py-2.5 font-medium text-slate-900">{row[1]}</td><td className="px-4 py-2.5 text-slate-600">{row[2]}</td></tr>)}</tbody></table></div>
          </section>

          {LESSONS.map(lesson => (
            <section key={lesson.id} id={lesson.id} className="scroll-mt-6 overflow-hidden rounded-xl border border-slate-200 bg-white break-inside-avoid">
              <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-100 px-5 py-4"><div className="flex gap-3"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-900 text-xs font-bold text-white">{lesson.number}</span><div><h2 className="font-semibold text-slate-950">{lesson.title}</h2><p className="mt-1 text-xs text-slate-500">建议用时：{lesson.duration}</p></div></div><label className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-700 print:hidden"><input type="checkbox" checked={completed.includes(lesson.id)} onChange={() => toggle(lesson.id)} className="h-4 w-4 rounded border-slate-300 text-emerald-600" />已完成本课</label></div>
              <div className="p-5"><p className="rounded-lg bg-slate-50 px-4 py-3 text-sm font-medium leading-6 text-slate-800">本课目标：{lesson.goal}</p><ol className="mt-5 space-y-3">{lesson.steps.map((step, index) => <li key={step} className="grid grid-cols-[24px_1fr] gap-3 text-sm leading-6 text-slate-600"><span className="flex h-6 w-6 items-center justify-center rounded-md border border-emerald-200 text-xs font-semibold text-emerald-700">{index + 1}</span><span>{step}</span></li>)}</ol><div className="mt-5 border-t border-slate-100 pt-4"><p className="text-sm font-semibold text-slate-900">实战作业</p><p className="mt-1 text-sm leading-6 text-slate-600">{lesson.assignment}</p><div className="mt-3 flex flex-wrap gap-2">{lesson.done.map(item => <span key={item} className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs text-slate-600">□ {item}</span>)}</div></div></div>
            </section>
          ))}

          <section className="rounded-xl border border-slate-200 bg-white p-5">
            <h2 className="font-semibold text-slate-900">官方补充资料</h2><p className="mt-1 text-sm text-slate-500">课程以实际作业为主；遇到界面变化时，以 Figma 官方说明为准。</p><div className="mt-4 flex flex-wrap gap-2">{OFFICIAL_LINKS.map(([label, href]) => <a key={href} href={href} target="_blank" rel="noreferrer" className="btn-secondary">{label}<span aria-hidden="true">↗</span></a>)}</div>
          </section>
        </main>
      </div>
    </div>
  )
}
