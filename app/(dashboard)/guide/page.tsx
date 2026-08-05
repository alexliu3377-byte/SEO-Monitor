'use client'

import { useUser } from '@/lib/user-context'

function StepBadge({ n }: { n: number }) {
  return (
    <span className="flex-shrink-0 w-6 h-6 rounded-full bg-green-600 text-white text-xs font-bold flex items-center justify-center">
      {n}
    </span>
  )
}

function ExtLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer"
      className="inline-flex items-center gap-1 text-xs text-green-700 bg-green-50 border border-green-200 rounded-full px-2.5 py-1 hover:bg-green-100 transition-colors whitespace-nowrap">
      {children}
      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
    </a>
  )
}

const NAV_WORKFLOW: { id: string; label: string }[] = [
  { id: 'wf-task-groups', label: '分组任务' },
  { id: 'wf-cookie-pool', label: 'Cookie 池维护' },
  { id: 'wf-group-report', label: '分组报告' },
]
const NAV_REFERENCE: { id: string; label: string }[] = [
  { id: 'ref-home', label: '首页快报' },
  { id: 'ref-site-intel', label: '站点情报' },
  { id: 'ref-weight-index', label: '权重/收录监控' },
  { id: 'ref-competitor-daily', label: '竞品日收' },
  { id: 'ref-index-pages', label: '收录页面' },
  { id: 'ref-charts', label: '近期榜单' },
  { id: 'ref-hot-keywords', label: '热词雷达' },
]
const NAV_ADMIN: { id: string; label: string }[] = [
  { id: 'admin-sites', label: '网站管理' },
  { id: 'admin-crawl-log', label: '抓取日志' },
  { id: 'admin-home', label: '首页快报' },
  { id: 'admin-rules', label: '规则中心' },
]

function Section({ id, children, className = '' }: { id: string; children: React.ReactNode; className?: string }) {
  return <section id={id} className={`scroll-mt-20 ${className}`}>{children}</section>
}

export default function GuidePage() {
  const { role } = useUser()
  const canSeeAll = role === 'super' || role === 'admin'

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="bg-white border-b border-gray-100 px-6 py-4">
        <h1 className="text-lg font-semibold text-gray-900">使用说明</h1>
        <p className="text-sm text-gray-400 mt-0.5">新人上手指南——每天要做什么、各个页面是干嘛的</p>
      </div>

      {/* 锚点导航：吸顶 */}
      <div className="sticky top-0 z-20 bg-white/95 backdrop-blur border-b border-gray-100 px-6 py-3 space-y-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] font-semibold text-green-700 mr-1">工作流程</span>
          {NAV_WORKFLOW.map(s => (
            <a key={s.id} href={`#${s.id}`}
              className="text-xs px-2.5 py-1 rounded-full bg-green-50 text-green-700 border border-green-200 hover:bg-green-100 transition-colors">
              {s.label}
            </a>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] font-medium text-gray-400 mr-1">参考工具</span>
          {NAV_REFERENCE.map(s => (
            <a key={s.id} href={`#${s.id}`}
              className="text-xs px-2.5 py-1 rounded-full bg-gray-50 text-gray-500 border border-gray-200 hover:bg-gray-100 transition-colors">
              {s.label}
            </a>
          ))}
        </div>
        {canSeeAll && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] font-semibold text-violet-700 mr-1">管理员</span>
            {NAV_ADMIN.map(s => (
              <a key={s.id} href={`#${s.id}`}
                className="text-xs px-2.5 py-1 rounded-full bg-violet-50 text-violet-700 border border-violet-200 hover:bg-violet-100 transition-colors">
                {s.label}
              </a>
            ))}
          </div>
        )}
      </div>

      <div className="px-6 py-6 max-w-4xl mx-auto space-y-10">

        {/* ══════════ 核心工作流程 ══════════ */}
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-lg">★</span>
            <h2 className="text-xl font-bold text-gray-900">核心工作流程</h2>
          </div>
          <p className="text-sm text-gray-500 mb-5">这一部分是你每天实际要做的事，最重要，建议先看这里。</p>

          <div className="space-y-6">
            {/* 分组任务 */}
            <Section id="wf-task-groups" className="bg-white rounded-2xl border-2 border-green-200 shadow-sm overflow-hidden">
              <div className="px-6 py-4 bg-green-50/60 border-b border-green-100 flex items-center justify-between">
                <h3 className="text-base font-bold text-gray-900">分组任务——认领词、提交工作</h3>
                <ExtLink href="/task-groups">打开分组任务</ExtLink>
              </div>
              <div className="p-6 space-y-5 text-sm text-gray-700">
                <p>右侧的每个 tab 都是一种"词的来源"，系统每天会自动挖出这些词，你只要挑感兴趣的认领去做：</p>
                <div className="grid grid-cols-2 gap-x-6 gap-y-2">
                  {[
                    ['分发词', '管理员手动指定、主动分给大家做的词'],
                    ['今日推荐', '系统按规则自动推荐的词'],
                    ['搜索量查询', '自己手动搜关键词库，查搜索量'],
                    ['搜索量上涨', '最近搜索量在涨的词'],
                    ['交叉词', '多个竞品站点同时新增/涨排名的词，信号更强'],
                    ['竞品涨排名', '竞品站点排名在上涨的词'],
                    ['连续上涨词', '连续多天搜索量走高的词'],
                    ['共新增词', '多个竞品站点同时新增的词'],
                    ['更新词库', '持续被搜索、适合拿现有页面去"更新"而不是新增的词根'],
                    ['跌词更新', '排名下跌了、需要更新页面挽回排名的词'],
                  ].map(([label, desc]) => (
                    <div key={label} className="flex items-center gap-2">
                      <span className="text-[10px] font-semibold text-green-700 bg-green-50 rounded px-1.5 py-0.5 flex-shrink-0 w-[74px] text-center">{label}</span>
                      <span className="text-xs text-gray-500">{desc}</span>
                    </div>
                  ))}
                </div>

                <div className="border-t border-gray-100 pt-4">
                  <p className="font-medium text-gray-800 mb-3">认领 → 提交 的完整流程：</p>
                  <div className="space-y-3">
                    <div className="flex items-start gap-3">
                      <StepBadge n={1} />
                      <p>在任意 tab 里双击想做的词，认领到左侧"今日任务"列表（同一个词一天内只能被一个人认领，抢到就是你的）。</p>
                    </div>
                    <div className="flex items-start gap-3">
                      <StepBadge n={2} />
                      <p>点开左侧列表里的词，展开填写：<b>操作类型</b>（新增/更新）、<b>最终做的词</b>（你实际写的标题/关键词）、<b>页面 URL</b>——三项都填了才能提交。</p>
                    </div>
                    <div className="flex items-start gap-3">
                      <StepBadge n={3} />
                      <p>单条填完可以直接点该条的"提交"，或者全部填完后用顶部的批量"提交"一次交完。</p>
                    </div>
                  </div>
                </div>

                <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
                  <p className="text-amber-700"><b>琥珀色"X/X 待提交"标签</b>：如果某天认领了词但没提交完就下班了，第二天打开会在"今天"的列表最上面自动出现，并带这个标签提醒你——这是以前认领的、还没提交的词。<b>看到这个标签一定要处理掉（补完提交或者点 × 删除），不要不管它</b>，因为没提交的词系统不会去抓排名/收录数据，等于白认领。</p>
                </div>
              </div>
            </Section>

            {/* Cookie 池维护 */}
            <Section id="wf-cookie-pool" className="bg-white rounded-2xl border-2 border-green-200 shadow-sm overflow-hidden">
              <div className="px-6 py-4 bg-green-50/60 border-b border-green-100">
                <h3 className="text-base font-bold text-gray-900">百度收录 Cookie 池维护——每天都要做</h3>
              </div>
              <div className="p-6 space-y-4 text-sm text-gray-700">
                <p>分组任务页面右上角有个"管理 Cookie 池"按钮——系统每天抓取百度收录数据要用到登录 Cookie，一个账号的 Cookie 用久了会失效，需要全组一起维护一个"轮换池"保持新鲜。</p>
                <div className="bg-gray-50 rounded-lg p-4 space-y-2">
                  <p className="font-medium text-gray-800">团队约定的做法：</p>
                  <ul className="list-disc list-inside space-y-1 text-gray-600">
                    <li>每人负责维护 <b>3 个</b> 账号的 Cookie</li>
                    <li>每天把池子里<b>最旧的那一条</b>（日期最早的）换成一个新取的 Cookie</li>
                    <li>取 Cookie 的方式：打开百度（已登录对应账号）→ 右键 inspect/检查 打开 DevTools → Application → Cookies → 全选复制 → 粘贴进弹窗的文本框，系统会自动识别</li>
                  </ul>
                </div>
                <p className="text-xs text-gray-400">每条 Cookie 前面都带一个日期小标签，一眼就能看出哪条最旧该换了。</p>
              </div>
            </Section>

            {/* 分组报告 */}
            <Section id="wf-group-report" className="bg-white rounded-2xl border-2 border-green-200 shadow-sm overflow-hidden">
              <div className="px-6 py-4 bg-green-50/60 border-b border-green-100 flex items-center justify-between">
                <h3 className="text-base font-bold text-gray-900">分组报告——看自己做得怎么样</h3>
                <ExtLink href="/group-report">打开分组报告</ExtLink>
              </div>
              <div className="p-6 space-y-4 text-sm text-gray-700">
                <div className="grid gap-3">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-green-700 bg-green-50 rounded px-1.5 py-0.5 flex-shrink-0 w-20 text-center">提交记录</span>
                    <span className="text-gray-600">按日期看谁那天提交了哪些词，最基础的流水记录。</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-green-700 bg-green-50 rounded px-1.5 py-0.5 flex-shrink-0 w-20 text-center">成效追踪</span>
                    <span className="text-gray-600">每一条提交后来有没有排上名、有没有被收录，逐条列出来，最后一列"得分"点一下能展开看这一条是怎么算出来的（排名档位 × 搜索量权重 + 收录分 + 涨跌分）。</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-green-700 bg-green-50 rounded px-1.5 py-0.5 flex-shrink-0 w-20 text-center">追踪汇总</span>
                    <span className="text-gray-600">月度整体统计：全组排名表（能看到自己和所有人排第几，但别人的具体数字看不到，只有自己那一行能看数字）、来源成效对比、获取收录/排名分布明细。</span>
                  </div>
                </div>
              </div>
            </Section>
          </div>
        </div>

        {/* ══════════ 参考工具 ══════════ */}
        <div>
          <h2 className="text-lg font-semibold text-gray-700 mb-1">参考工具</h2>
          <p className="text-sm text-gray-400 mb-5">这些是平时"去看数据"的地方，不涉及要提交什么操作，按需查阅就好。</p>

          <div className="space-y-4">
            <Section id="ref-home" className="bg-white rounded-xl border border-gray-200 p-5">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-semibold text-gray-800">首页快报</h3>
                <ExtLink href="/">打开首页快报</ExtLink>
              </div>
              <p className="text-sm text-gray-600">登录后第一眼看的总览页。顶部 4 张预警卡片——权重变动 / 收录变动 / 新增变动 / 搜索量查询——出现红色或橙色说明有站点异常，点卡片里的条目会弹出这个站点的详情（权重、IP、收录趋势等）。下面还有大站/中站/小站的对比图表，可以勾选站点看趋势对比。</p>
            </Section>

            <Section id="ref-site-intel" className="bg-white rounded-xl border border-gray-200 p-5">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-semibold text-gray-800">站点情报</h3>
                <ExtLink href="/site-intel">打开站点情报</ExtLink>
              </div>
              <p className="text-sm text-gray-600">就是个搜索框——想看某个域名的完整数据，直接在这里搜，会跳到该站点的详情页。侧边栏"站点情报"下面还挂了四个子页面：</p>
              <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs text-gray-500">
                <p>· <b className="text-gray-700">权重监控</b>——全站点 PC/移动权重、来路 IP 列表</p>
                <p>· <b className="text-gray-700">收录监控</b>——全站点收录量趋势 + 状态判定</p>
                <p>· <b className="text-gray-700">竞品日收</b>——竞品新增词监控（下面单独展开讲）</p>
                <p>· <b className="text-gray-700">收录页面</b>——收录到具体 URL 级别的追踪</p>
              </div>
            </Section>

            <Section id="ref-weight-index" className="bg-white rounded-xl border border-gray-200 p-5">
              <h3 className="text-sm font-semibold text-gray-800 mb-2">权重监控 / 收录监控</h3>
              <p className="text-sm text-gray-600">两个页面结构很像：一个筛选栏（域名、关注级别，收录监控还多一个"状态"筛选）+ 一张表格，每行是一个站点，带 30 天趋势小图。表格标题点一下可以按数值排序。每行"查看"按钮能弹出更大的趋势图。</p>
            </Section>

            <Section id="ref-competitor-daily" className="bg-white rounded-xl border border-gray-200 p-5">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-semibold text-gray-800">竞品日收——按钮最多，重点看一下</h3>
                <ExtLink href="/competitor-daily">打开竞品日收</ExtLink>
              </div>
              <p className="text-sm text-gray-600 mb-3">对比每个竞品站点昨天新增了多少关键词，状态列会标"正常/偏低/异常/偏高"——先按状态筛出异常的站点，再用下面这几个按钮深挖原因：</p>
              <div className="space-y-2">
                {[
                  ['查看', '弹出近30天新增趋势折线图，带工作日/周末均值基线，方便判断是不是真的异常还是周末本来就低'],
                  ['昨日新词', '当天具体新增了哪些关键词，分应用/游戏两个 tab，可以选日期回看历史'],
                  ['更新词库', '近30天持续出现的词根聚合，点开能展开看具体变体词——适合拿去"更新词库"tab认领做'],
                  ['排名变动', '涨入/跌出的关键词排名波动列表，带搜索量'],
                  ['不稳定词', '近30天在涨入和跌出里都出现过的词，按波动天数排序——排名很不稳定的词'],
                ].map(([label, desc]) => (
                  <div key={label} className="flex items-center gap-2 text-sm">
                    <span className="text-xs font-semibold text-blue-700 bg-blue-50 rounded px-1.5 py-0.5 flex-shrink-0 w-16 text-center">{label}</span>
                    <span className="text-gray-600">{desc}</span>
                  </div>
                ))}
              </div>
            </Section>

            <Section id="ref-index-pages" className="bg-white rounded-xl border border-gray-200 p-5">
              <h3 className="text-sm font-semibold text-gray-800 mb-2">收录页面</h3>
              <p className="text-sm text-gray-600">追踪到具体页面（URL）级别的收录状态，记录首次发现/消失/再收录的时间。可以按站点、时间范围、状态（新发现/再收录/已脱收/待验证/更新/已收录）筛选。</p>
            </Section>

            <Section id="ref-charts" className="bg-white rounded-xl border border-gray-200 p-5">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-semibold text-gray-800">近期榜单</h3>
                <ExtLink href="/charts">打开近期榜单</ExtLink>
              </div>
              <p className="text-sm text-gray-600">纯资讯页，汇总 TapTap 和好游快爆的游戏行业榜单（今日游戏、即将上线、热搜榜等），跟自家站点数据完全无关，了解行业动态、蹭热点选题时看看就好，<b>只供参考</b>。</p>
            </Section>

            <Section id="ref-hot-keywords" className="bg-white rounded-xl border border-gray-200 p-5">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-semibold text-gray-800">热词雷达</h3>
                <ExtLink href="/hot-keywords">打开热词雷达</ExtLink>
              </div>
              <p className="text-sm text-gray-600">用来了解行业整体趋势、给分组任务的认领补灵感。右侧 6 个 tab（搜索量上涨/交叉词/竞品涨排名/连续上涨词/共新增词/更新词库）跟分组任务里的信号来源是同一套逻辑，只是这里是纯浏览，不能直接认领去做。理论上分组任务的词可以由管理员按分组筛选站点范围，热词雷达则看全部站点；不过现阶段各分组都还没设置筛选，两边看到的范围其实一样，这里就当参考用。</p>
            </Section>
          </div>
        </div>

        {/* ══════════ 管理员专区 ══════════ */}
        {canSeeAll && (
          <div id="admin-zone" className="scroll-mt-20">
            <h2 className="text-lg font-semibold text-violet-700 mb-1">管理员</h2>
            <p className="text-sm text-gray-400 mb-5">只有管理权限能看到这一块。</p>

            <div className="space-y-4">
              <Section id="admin-sites" className="bg-white rounded-xl border border-violet-200 p-5">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-semibold text-gray-800">网站管理</h3>
                  <ExtLink href="/sites">打开网站管理</ExtLink>
                </div>
                <p className="text-sm text-gray-600 mb-3">站点要先在这里登记，才会进入整个监控/抓取系统——是所有数据的源头。</p>
                <div className="space-y-2 text-sm text-gray-600">
                  <p>· <b className="text-gray-700">新增网站</b>：右上角"新增网站"，要填域名、站点名称、分类（大站/中站/小站）、关注级别（1=重点关注 / 2=侧重关注 / 3=普通关注）、友情链接，以及一份抓取用的 HTML 配置（内容类型、列表页 URL、标题/日期/文章链接的 CSS 选择器等）。</p>
                  <p>· <b className="text-gray-700">列表操作</b>：编辑、删除（<span className="text-red-500">删除不可恢复</span>），可按域名/关注级别/分类筛选。</p>
                  <p>· <b className="text-gray-700">4 个开关</b>：启用抓取、排名数据、竞品追踪、收录页面追踪，表格里直接点就能改。</p>
                  <p className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-amber-700">⚠ "排名数据"和"竞品追踪"两个开关不能同时开——同时开启会弹出数据迁移确认框，迁移会丢弃一部分字段（比如 PC 端数据），操作前务必看清楚提示再确认。</p>
                </div>
              </Section>

              <Section id="admin-crawl-log" className="bg-white rounded-xl border border-violet-200 p-5">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-semibold text-gray-800">抓取日志</h3>
                  <ExtLink href="/crawl-log">打开抓取日志</ExtLink>
                </div>
                <p className="text-sm text-gray-600 mb-3">监控每天的抓取任务有没有正常跑完，纯监控+出问题时补救，不是配置页。</p>
                <div className="space-y-2 text-sm text-gray-600">
                  <p>· <b className="text-gray-700">今日任务卡片</b>：关键词/权重/排名 3 张，显示成功/空/失败站点数；有异常可以"查看"展开具体是哪些站点出问题，或者点"重试"勾选失败/空的站点重新抓一次。</p>
                  <p>· <b className="text-gray-700">运行记录表</b>：按日期/类型/域名筛选，也有"运行异常"快捷筛选；每行能"查看"这次运行的站点明细。</p>
                  <p>· <b className="text-gray-700">"规则"按钮</b>：点开会弹出这一类抓取的完整说明——触发时间/触发方式、抓取对象、数据来源、限流策略、写入哪张表、已知风险，排查"为什么这个站点没抓到"时先看这个。</p>
                </div>
              </Section>

              <Section id="admin-home" className="bg-white rounded-xl border border-violet-200 p-5">
                <h3 className="text-sm font-semibold text-gray-800 mb-2">首页快报里的管理员功能</h3>
                <p className="text-sm text-gray-600 mb-3">普通成员看到的首页快报没有导出功能，管理员额外多两处：</p>
                <div className="space-y-2 text-sm text-gray-600">
                  <p>· <b className="text-gray-700">收录变动卡片</b>——"涨词导出"/"跌词导出"：点击后要再输一次爱站账号密码验证，成功后按域名+日期范围（最多7天，爱站接口限制）逐日抓取涨入/跌出的关键词，生成一份按天分 sheet 的 Excel 下载。</p>
                  <p>· <b className="text-gray-700">搜索量查询卡片</b>——"导出今日"/"导出全部"：同样要账号密码验证，导出关键词+搜索量的 CSV。</p>
                </div>
              </Section>

              <Section id="admin-rules" className="bg-white rounded-xl border border-dashed border-violet-200 p-5">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-gray-800">规则中心</h3>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-violet-50 text-violet-500 border border-violet-200">开发中</span>
                </div>
              </Section>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
