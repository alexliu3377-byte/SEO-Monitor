'use client'

import Link from 'next/link'
import { useUser } from '@/lib/user-context'

type GuideLink = { id: string; label: string }

const DAILY_NAV: GuideLink[] = [
  { id: 'daily-tasks', label: '认领与提交' },
  { id: 'daily-cookie', label: 'Cookie 池' },
  { id: 'daily-results', label: '查看成效' },
  { id: 'daily-feedback', label: '反馈提醒' },
]

const TOOL_NAV: GuideLink[] = [
  { id: 'tool-overview', label: '首页与站点' },
  { id: 'tool-competitor', label: '竞品日收' },
  { id: 'tool-trends', label: '趋势与热词' },
  { id: 'tool-research', label: '研究中心' },
]

const ADMIN_NAV: GuideLink[] = [
  { id: 'admin-sites', label: '网站管理' },
  { id: 'admin-jobs', label: '抓取与缓存' },
  { id: 'admin-permissions', label: '权限说明' },
]

function PageLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-slate-200 bg-transparent px-3 text-xs font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500">
      {children}
      <svg aria-hidden="true" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="m9 18 6-6-6-6" /></svg>
    </Link>
  )
}

function Section({ id, title, description, href, linkLabel, children }: {
  id: string
  title: string
  description?: string
  href?: string
  linkLabel?: string
  children: React.ReactNode
}) {
  return (
    <section id={id} className="scroll-mt-24 overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
          {description && <p className="mt-1 text-xs leading-5 text-slate-500">{description}</p>}
        </div>
        {href && <PageLink href={href}>{linkLabel ?? '打开页面'}</PageLink>}
      </div>
      <div className="px-5 py-4 text-sm leading-6 text-slate-600">{children}</div>
    </section>
  )
}

function Step({ number, title, children }: { number: number; title: string; children: React.ReactNode }) {
  return (
    <li className="grid grid-cols-[28px_1fr] gap-3">
      <span className="flex h-7 w-7 items-center justify-center rounded-md border border-emerald-200 text-xs font-semibold text-emerald-700">{number}</span>
      <div><p className="font-medium text-slate-800">{title}</p><p className="mt-0.5 text-slate-600">{children}</p></div>
    </li>
  )
}

function Notice({ tone = 'neutral', title, children }: { tone?: 'neutral' | 'warning' | 'danger'; title: string; children: React.ReactNode }) {
  const styles = tone === 'danger'
    ? 'border-red-200 bg-red-50/70 text-red-800'
    : tone === 'warning'
      ? 'border-amber-200 bg-amber-50/70 text-amber-800'
      : 'border-slate-200 bg-slate-50 text-slate-700'
  return <div className={`rounded-lg border px-4 py-3 text-sm leading-6 ${styles}`}><p className="font-semibold">{title}</p><div className="mt-0.5">{children}</div></div>
}

function QuickRow({ name, children }: { name: string; children: React.ReactNode }) {
  return <div className="grid gap-1 border-b border-slate-100 py-2.5 last:border-0 sm:grid-cols-[132px_1fr] sm:gap-4"><p className="font-medium text-slate-800">{name}</p><p>{children}</p></div>
}

function SideNav({ title, items }: { title: string; items: GuideLink[] }) {
  return (
    <div>
      <p className="mb-1.5 px-2 text-xs font-semibold text-slate-400">{title}</p>
      <div className="space-y-0.5">
        {items.map(item => <a key={item.id} href={`#${item.id}`} className="block rounded-md px-2 py-1.5 text-sm text-slate-600 hover:bg-slate-100 hover:text-slate-900">{item.label}</a>)}
      </div>
    </div>
  )
}

export default function GuidePage() {
  const { role } = useUser()
  const canManage = role === 'super' || role === 'admin'

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white px-5 py-5 sm:px-8">
        <div className="mx-auto flex max-w-7xl flex-wrap items-end justify-between gap-4">
          <div><h1 className="text-2xl font-bold tracking-tight text-slate-950">使用说明</h1><p className="mt-1.5 text-sm text-slate-500">先看每日工作流程；需要某项数据时，再查对应页面。</p></div>
          <p className="text-xs tabular-nums text-slate-400">最后更新：2026/09/25</p>
        </div>
      </header>

      <div className="mx-auto grid max-w-7xl gap-6 px-4 py-6 sm:px-8 lg:grid-cols-[190px_minmax(0,1fr)]">
        <aside className="hidden self-start lg:sticky lg:top-5 lg:block">
          <nav aria-label="使用说明目录" className="space-y-5 rounded-xl border border-slate-200 bg-white p-3">
            <SideNav title="每日工作" items={DAILY_NAV} />
            <SideNav title="页面速查" items={TOOL_NAV} />
            {canManage && <SideNav title="管理员" items={ADMIN_NAV} />}
          </nav>
        </aside>

        <main className="min-w-0 space-y-8">
          <nav aria-label="移动端使用说明目录" className="flex gap-2 overflow-x-auto border-b border-slate-200 pb-3 lg:hidden">
            {[...DAILY_NAV, ...TOOL_NAV, ...(canManage ? ADMIN_NAV : [])].map(item => <a key={item.id} href={`#${item.id}`} className="shrink-0 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-600">{item.label}</a>)}
          </nav>

          <div>
            <h2 className="text-base font-semibold text-slate-900">每天要做什么</h2>
            <p className="mt-1 text-sm text-slate-500">按下面顺序完成即可，其他页面都是查询和辅助工具。</p>
            <div className="mt-4 space-y-4">
              <Section id="daily-tasks" title="1. 认领并提交当天任务" description="任务工作台是组员每天主要操作的页面。" href="/content/task-groups" linkLabel="打开任务工作台">
                <ol className="space-y-4">
                  <Step number={1} title="选择任务">从来源 Tab 中找到合适的词，点击“认领”；双击整行只是快捷操作。</Step>
                  <Step number={2} title="完成内容">在左侧任务列表填写操作类型、最终关键词和页面 URL。三项完整后才能提交。</Step>
                  <Step number={3} title="选择新增或更新">第一次制作该内容选择“新增”；同一成员、同一关键词、同一 URL 已提交过新增时，后续必须选择“更新”。</Step>
                  <Step number={4} title="提交并清理待办">可以逐条提交，也可以批量提交。以前日期遗留的待提交任务要补完或移除，不要长期保留。</Step>
                </ol>
                <div className="mt-4"><Notice tone="warning" title="补做旧任务时也按内容身份判断">记录日期可以是旧日期，但系统仍会检查这个成员是否已用相同关键词和 URL 提交过“新增”。重复内容不是第二次新增，应改为“更新”。</Notice></div>
              </Section>

              <Section id="daily-cookie" title="2. 检查百度 Cookie 池" description="Cookie 失效会直接影响收录验证。" href="/content/task-groups" linkLabel="前往维护">
                <p>在任务工作台打开 Cookie 池，优先替换日期最旧或已经失效的记录。每位成员按团队约定维护自己的账号，不要覆盖仍在使用的其他成员记录。</p>
                <p className="mt-2 text-xs text-slate-500">如果页面提示需要重新验证，先刷新 Cookie，再等待下一轮验证任务；不要把“未验证到”直接当成页面掉收录。</p>
              </Section>

              <Section id="daily-results" title="3. 查看提交成效" description="确认提交后的收录、排名和得分依据。" href="/content/group-report" linkLabel="打开成效报告">
                <div className="divide-y divide-slate-100"><QuickRow name="提交概况">查看成员提交量、搜索量及来源构成。</QuickRow><QuickRow name="成效追踪">逐条查看收录、M/PC 排名和评分；点击得分可查看计算依据。</QuickRow><QuickRow name="追踪汇总">查看一段时间内的成员、来源和成效分布。</QuickRow></div>
                <div className="mt-4"><Notice title="排名判定规则">M 与 PC 分开保存并分别显示。当天未在抓取范围内找到只表示“未找到/可能超出范围”，不会直接判定为下降；同日同时出现升跌时保留两份证据，评分先采用上涨结果。</Notice></div>
              </Section>

              <Section id="daily-feedback" title="4. 查看反馈新消息" description="侧边栏出现数字时，表示有尚未阅读的新回复。" href="/content/feedback" linkLabel="打开反馈优化">
                <p>反馈留言板用于提交问题、优化建议和新站点。收到回复后，侧边栏“反馈优化”会显示未读数量；打开对应反馈即可阅读并继续沟通。</p>
              </Section>
            </div>
          </div>

          <div>
            <h2 className="text-base font-semibold text-slate-900">页面速查</h2>
            <p className="mt-1 text-sm text-slate-500">不需要每天逐页查看；根据问题选择页面。</p>
            <div className="mt-4 space-y-4">
              <Section id="tool-overview" title="首页快报与站点情报" href="/content" linkLabel="打开首页">
                <div className="divide-y divide-slate-100"><QuickRow name="首页快报">快速看权重、收录、新增和搜索量异常。</QuickRow><QuickRow name="站点搜索">输入域名进入单站完整资料。</QuickRow><QuickRow name="权重监控">比较站点 PC/M 权重、来路和近期趋势。</QuickRow><QuickRow name="收录监控">查看站点收录走势；具体 URL 请进入“收录页面”。</QuickRow></div>
              </Section>

              <Section id="tool-competitor" title="竞品日收" description="查看竞品昨日新词、排名波动和异常站点。" href="/content/competitor-daily" linkLabel="打开竞品日收">
                <p>先用状态、站点或日期筛选，再查看具体新词和排名变化。原始“昨日新词”和排名波动明细保留 40 天，月报会在保留期内完成汇总；更长期趋势请查看研究报告。</p>
                <div className="mt-3 divide-y divide-slate-100"><QuickRow name="昨日新词">查看指定日期新出现的关键词。</QuickRow><QuickRow name="排名波动">分别查看涨入和跌出，不把“未找到”当作下跌。</QuickRow><QuickRow name="更新词库">查看持续出现、适合更新现有内容的词。</QuickRow></div>
              </Section>

              <Section id="tool-trends" title="热词雷达与趋势发现" href="/content/trend-discovery" linkLabel="打开趋势发现">
                <div className="divide-y divide-slate-100"><QuickRow name="热词雷达">根据站点排名、搜索量和竞品数据查看已形成的数据趋势。</QuickRow><QuickRow name="趋势词">根据公开社媒内容识别正在升温的候选词，并解释趋势分来源。</QuickRow><QuickRow name="新词发现">查看平台搜索推荐词；管理员可加入采集或忽略。</QuickRow></div>
                <p className="mt-3 text-xs text-slate-500">社媒推荐词是后续采集线索，不等于已经形成趋势；是否成立仍要看公开内容证据。</p>
              </Section>

              <Section id="tool-research" title="研究中心" href="/content/research" linkLabel="打开研究中心">
                <div className="divide-y divide-slate-100"><QuickRow name="商业词研究">维护商业词组、扩展推荐词并检查站点覆盖，全体组员可用。</QuickRow><QuickRow name="研究报告">查看自动生成的周报、月报、季报和年报，全体组员可用。</QuickRow><QuickRow name="成效与诊断">查看竞品成效或对单站进行诊断，仅管理员和超管可用。</QuickRow></div>
              </Section>
            </div>
          </div>

          {canManage && (
            <div>
              <h2 className="text-base font-semibold text-slate-900">管理员维护</h2>
              <p className="mt-1 text-sm text-slate-500">配置与补救操作会影响全站数据，修改前先确认范围。</p>
              <div className="mt-4 space-y-4">
                <Section id="admin-sites" title="网站管理" href="/content/sites" linkLabel="打开网站管理">
                  <div className="divide-y divide-slate-100"><QuickRow name="基础配置">维护域名、站点分类、关注级别和抓取开关。</QuickRow><QuickRow name="抓取能力">关键词、涨跌、排名和收录页面按实际需求开启；无有效来源时不要空跑。</QuickRow><QuickRow name="排名 Excel">通过 GitHub Actions 补录排名资料；只保留目标主域、搜索量大于 0 的有效记录。</QuickRow></div>
                  <div className="mt-4"><Notice tone="danger" title="不要把两个排名来源随意切换">涨跌记录和完整排名保存的字段与用途不同。调整开关或迁移数据前，先确认是否会影响 PC/M 资料和成效追踪。</Notice></div>
                </Section>

                <Section id="admin-jobs" title="抓取日志与成效缓存" href="/content/crawl-log" linkLabel="打开抓取日志">
                  <p>抓取日志用于确认每日任务是否成功、哪些站点为空或失败。失败任务应先查错误原因，再只重跑受影响的范围。</p>
                  <p className="mt-2">补录排名、修改评分 SQL 或修复追踪资料后，通过对应 GitHub Actions 刷新成效缓存；不要为了单个站点反复重跑全部任务。</p>
                </Section>

                <Section id="admin-permissions" title="当前权限说明">
                  <div className="divide-y divide-slate-100"><QuickRow name="全部组员">任务工作台、商业词研究、研究报告、趋势与日常监控工具。</QuickRow><QuickRow name="管理员/超管">成效与诊断、网站管理、抓取日志及需要全局数据的管理操作。</QuickRow><QuickRow name="项目负责人">反馈处理、状态管理及项目级沟通。</QuickRow></div>
                </Section>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  )
}
