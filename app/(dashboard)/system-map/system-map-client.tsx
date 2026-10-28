'use client'

import { useState } from 'react'

type FlowNode = { id: string; x: number; y: number; title: string; lines: string[]; href?: string; kind?: 'entry' | 'main' | 'condition' }
type FlowEdge = { path: string; dashed?: boolean }
const mainNodes: FlowNode[] = [
  { id: 'sites', x: 615, y: 30, title: '网站管理', lines: ['登记自家 / 竞品站点', '配置来源、选择器与采集开关'], href: '/content/sites', kind: 'entry' },
  { id: 'weight', x: 30, y: 230, title: '权重监控', lines: ['爱站 · PC / 移动权重', '记录每日权重与来路 IP'], href: '/content/weight-monitor' },
  { id: 'daily', x: 400, y: 230, title: '竞品日收', lines: ['竞品列表 · 新增与更新词', '保留来源、日期与文章链接'], href: '/content/competitor-daily', kind: 'main' },
  { id: 'index', x: 770, y: 230, title: '收录监控', lines: ['爱站 · 站点收录总量', '观察每日收录变化'], href: '/content/index-monitor' },
  { id: 'pages', x: 1140, y: 230, title: '收录页面', lines: ['百度 · site: 域名搜索', '追踪具体 URL 的收录变化'], href: '/content/index-pages' },
  { id: 'volume', x: 30, y: 470, title: '搜索量查询', lines: ['查询关键词已有搜索量', '入口：任务工作台'], href: '/content/task-groups' },
  { id: 'radar', x: 400, y: 470, title: '热词雷达', lines: ['匹配自制信号条件', '汇合新增、涨排与搜索量信号'], href: '/content/hot-keywords', kind: 'main' },
  { id: 'tasks', x: 770, y: 470, title: '任务工作台', lines: ['筛选站点 → 分发 → 组员认领', '任务提交：内容与自己站点链接'], href: '/content/task-groups', kind: 'main' },
  { id: 'report', x: 1140, y: 470, title: '成效报告', lines: ['以已提交链接进行追踪', '查看收录、排名与任务成效'], href: '/content/group-report', kind: 'main' },
  { id: 'wordlib', x: 30, y: 690, title: '词库补充', lines: ['分类、分配站点与补充状态', '资料来自关键词搜索量库'], href: '/content/keyword-classification' },
  { id: 'rank', x: 400, y: 690, title: '排名与关键词搜索量库', lines: ['涨跌词、排名明细、搜索量', '作为雷达信号的补充依据'], kind: 'condition' },
  { id: 'own', x: 770, y: 690, title: '自己站点的信号条件', lines: ['已有提交、涨排 / 跌排等信号', '配合站点过滤筛选任务'], kind: 'condition' },
  { id: 'monthly', x: 30, y: 910, title: '内容发现 · 月度趋势', lines: ['竞品关键词与站点历史汇总', '观察每月内容与站点变化'], href: '/content/charts?section=monthly' },
  { id: 'history', x: 400, y: 910, title: '站点历史与大环境', lines: ['权重、收录、关键词与排名', '汇合自己和竞品的成效资料'], kind: 'condition' },
  { id: 'research', x: 770, y: 910, title: '研究中心', lines: ['竞品成效 · 站点诊断', '周 / 月 / 季 / 年研究报告'], href: '/content/research', kind: 'main' },
  { id: 'gaps', x: 1140, y: 1130, title: '机会缺口', lines: ['竞品有效词 − 我方已提交词', '找出尚未覆盖的内容机会'], href: '/content/research', kind: 'condition' },
  { id: 'decisions', x: 770, y: 1130, title: '人工选择与任务调整', lines: ['结合研究结论和机会缺口', '选择选题，再调整工作台任务'], kind: 'condition' },

]
const mainEdges: FlowEdge[] = [
  { path: 'M740 154 V190 H155 V230' }, { path: 'M740 190 H525 V230' },
  { path: 'M740 190 H895 V230' }, { path: 'M740 190 H1265 V230' },
  { path: 'M525 354 V470' },
  { path: 'M400 752 H350 V532 H280' },
  { path: 'M400 752 H280' },
  { path: 'M650 532 H770' }, { path: 'M1020 532 H1140' },
  { path: 'M525 690 V594', dashed: true }, { path: 'M895 690 V594', dashed: true },
  { path: 'M400 972 H280' }, { path: 'M650 972 H770' },
  { path: 'M1390 532 H1410 V972 H1020' },
  { path: 'M895 1034 V1130' },
  { path: 'M1020 972 H1265 V1130' },
  { path: 'M1140 1192 H1020' },
  { path: 'M895 1130 H1070 V640 H1020 V594', dashed: true },
  { path: 'M650 752 H700 V620 H1265 V594', dashed: true },
  { path: 'M1265 354 V470' },

]
const extraNodes: FlowNode[] = [
  { id: 'calendar-source', x: 30, y: 35, title: 'TapTap / 好游快爆', lines: ['游戏日历、热门榜与热门搜索', '即将上线、即将更新的游戏'], kind: 'entry' },
  { id: 'calendar-process', x: 420, y: 35, title: '游戏资讯与搜索趋势', lines: ['读取公开页面 / 日历资料', '保留来源时间、榜种与标签'], kind: 'main' },
  { id: 'calendar-use', x: 810, y: 35, title: '内容发现 · 游戏', lines: ['看上线时间与平台热度', '作为选题参考，不等于搜索量'], href: '/content/charts?section=game' },
  { id: 'content-source', x: 30, y: 220, title: '资讯与视频来源', lines: ['B 站 / 小红书 / 小黑盒', '吾爱破解 / 4399 / 虫虫助手'], kind: 'entry' },
  { id: 'content-process', x: 420, y: 220, title: '资料采集与文字整理', lines: ['标题、原文、日期 → 去重入库', '正文 / 字幕 / 语音转写'], kind: 'main' },
  { id: 'content-use', x: 810, y: 220, title: '内容发现 · 资讯 / 应用', lines: ['软件分享、游戏资讯与视频', '查看资料，人工准备内容选题'], href: '/content/charts?section=content' },
  { id: 'game-source', x: 30, y: 405, title: '小游戏榜单来源', lines: ['抖音 / 微信小游戏', 'MomoRank 公开免费资料'], kind: 'entry' },
  { id: 'game-process', x: 420, y: 405, title: '榜单与热度快照', lines: ['保留榜种、名次与来源日期', '热度不当作搜索量'], kind: 'main' },
  { id: 'game-use', x: 810, y: 405, title: '内容发现 · 小游戏', lines: ['观察新游与榜单变化', '为游戏选题提供参考'], href: '/content/charts?section=game&source=douyin_minigame&view=rankings' },
  { id: 'app-source', x: 30, y: 590, title: '应用更新来源', lines: ['App Store / Google Play / TapTap', '管理员登记的更新网页'], kind: 'entry' },
  { id: 'app-process', x: 420, y: 590, title: '发现应用与检查版本', lines: ['提取版本号、日期与更新日志', '按来源与版本去重'], kind: 'main' },
  { id: 'app-use', x: 810, y: 590, title: '应用更新中心', lines: ['新版本进入待审核', '人工通过后更新当前版本'], href: '/app-updates' },
  { id: 'trend-source', x: 30, y: 775, title: '小红书 / 抖音搜索', lines: ['按设置的搜索词读取首屏', '标题、标签与可见互动数字'], kind: 'entry' },
  { id: 'trend-process', x: 420, y: 775, title: '平台需求信号', lines: ['整理公开结果卡片', '保留来源与可见日期'], kind: 'main' },
  { id: 'trend-use', x: 810, y: 775, title: '趋势发现', lines: ['观察平台上出现的话题', '人工判断是否值得做内容'], href: '/content/trend-discovery' },
  { id: 'commercial-source', x: 30, y: 960, title: '商业词组与百度下拉', lines: ['手动词组 + 百度建议词', '结合已有站点排名资料'], kind: 'entry' },
  { id: 'commercial-process', x: 420, y: 960, title: '覆盖匹配与新词发现', lines: ['对照自己 / 竞品排名覆盖', '从排名标题发现候选词'], kind: 'main' },
  { id: 'commercial-use', x: 810, y: 960, title: '研究中心 · 商业词研究', lines: ['维护词组、核对覆盖与机会', '由人工决定后续内容方向'], href: '/content/research' },
]
const extraEdges = [97, 282, 467, 652, 837, 1022].flatMap(y => [{ path: `M280 ${y} H420` }, { path: `M670 ${y} H810` }])

function Diagram({ id, nodes, edges, width, height, label }: { id: string; nodes: FlowNode[]; edges: FlowEdge[]; width: number; height: number; label: string }) {
  const [zoom, setZoom] = useState<number | null>(null)
  return <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-2">
      <p className="text-xs text-slate-500">点击页面节点可进入对应功能 · 放大后可横向滚动</p>
      <div className="flex items-center gap-1" role="group" aria-label={label + '缩放'}>
        <button type="button" onClick={() => setZoom(null)} aria-pressed={zoom === null} className="min-h-11 rounded px-3 text-xs text-emerald-700 hover:bg-emerald-50 focus-visible:outline-emerald-600">适应宽度</button>
        <button type="button" onClick={() => setZoom(Math.max(60, (zoom ?? 100) - 20))} aria-label="缩小" className="min-h-11 min-w-11 rounded text-slate-600 hover:bg-slate-100">−</button>
        <span className="w-10 text-center text-xs text-slate-500">{zoom === null ? '自动' : zoom + '%'}</span>
        <button type="button" onClick={() => setZoom(Math.min(160, (zoom ?? 100) + 20))} aria-label="放大" className="min-h-11 min-w-11 rounded text-slate-600 hover:bg-slate-100">+</button>
      </div>
    </div>
    <div className="overflow-auto bg-slate-50/60 p-3" tabIndex={0} role="region" aria-label={label + '画布'}>
      <svg viewBox={`0 0 ${width} ${height}`} style={{ width: zoom === null ? '100%' : width * zoom / 100, minWidth: zoom === null ? 760 : undefined }} className="block" role="group" aria-labelledby={id + '-title'}>
        <title id={id + '-title'}>{label}。实线表示资料或任务流向，虚线表示信号补充或人工反馈。页面节点可点击。</title>
        <defs>
          <pattern id={id + '-dots'} width="24" height="24" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="1" fill="#dbe3eb" /></pattern>
          <marker id={id + '-arrow'} markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M1 1 L7 4 L1 7" fill="none" stroke="#6b928b" strokeWidth="1.4" /></marker>
        </defs>
        <rect width={width} height={height} fill={`url(#${id}-dots)`} />
        {edges.map((edge, index) => <path key={index} d={edge.path} fill="none" stroke={edge.dashed ? '#94a3b8' : '#6b928b'} strokeWidth="2" strokeDasharray={edge.dashed ? '7 5' : undefined} markerEnd={`url(#${id}-arrow)`} />)}
        {nodes.map(node => {
          const entry = node.kind === 'entry'
          const main = node.kind === 'main'
          const content = <g>
            <rect x={node.x} y={node.y + 3} width="250" height="124" rx="12" fill="#0f172a" opacity=".035" />
            <rect x={node.x} y={node.y} width="250" height="124" rx="12" fill={entry ? '#163d3a' : main ? '#ecfdf5' : '#ffffff'} stroke={main ? '#8ed6bc' : node.kind === 'condition' ? '#cbd5e1' : '#d7e0e7'} strokeDasharray={node.kind === 'condition' ? '5 4' : undefined} />
            <text x={node.x + 18} y={node.y + 34} fontSize="18" fontWeight="650" fill={entry ? '#ffffff' : '#163d3a'}>{node.title}</text>
            {node.lines.map((line, index) => <text key={line} x={node.x + 18} y={node.y + 66 + index * 25} fontSize="14" fill={entry ? '#c1ded9' : '#526572'}>{line}</text>)}
          </g>
          return node.href ? <a key={node.id} href={node.href} aria-label={node.title + '：' + node.lines.join('；')} className="outline-offset-4 hover:opacity-80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-600">{content}</a> : <g key={node.id}>{content}</g>
        })}
      </svg>
    </div>
  </div>
}

export default function SystemMapClient() {
  return <div className="space-y-8">
    <header>
      <p className="text-xs font-medium text-emerald-700">系统地图</p>
      <h1 className="mt-1 text-2xl font-bold text-slate-900">从资料采集，到内容成效</h1>
      <p className="mt-2 text-sm text-slate-500">一张图看清主要业务流，另一张图说明额外资料任务。所有流程直接展开，无需切换分类。</p>
    </header>
    <section aria-labelledby="main-flow-heading">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 id="main-flow-heading" className="text-base font-semibold text-slate-900">主流程 · 站点资料 → 信号筛选 → 内容任务 → 成效追踪</h2>
        <div className="flex gap-4 text-xs text-slate-500"><span>实线：资料 / 任务流向</span><span>虚线：补充信号 / 人工反馈</span></div>
      </div>
      <Diagram id="main-flow" nodes={mainNodes} edges={mainEdges} width={1430} height={1300} label="站点资料与任务成效主流程" />
      <p className="mt-2 text-xs leading-5 text-slate-500">成效追踪结合已提交链接、收录与排名资料；研究中心汇合历史和成效，供人工调整下一轮任务。</p>
    </section>
    <section aria-labelledby="extra-flow-heading">
      <h2 id="extra-flow-heading" className="mb-1 text-base font-semibold text-slate-900">额外资料任务 · 内容、榜单、版本与搜索</h2>
      <p className="mb-3 text-sm text-slate-500">这些任务提供额外资料，不默认进入上面的分发与发布流程。</p>
      <Diagram id="extra-flow" nodes={extraNodes} edges={extraEdges} width={1100} height={1120} label="额外资料任务流程" />
    </section>
    <div className="border-t border-slate-200 pt-4 text-xs leading-6 text-slate-500">
      <p>资料口径：榜单热度不等于搜索量；首次发现日期不等于发布日期。</p>
      <p>任务边界：研究结论与内容资料由人工选择使用，不自动发布。</p>
    </div>
  </div>
}
