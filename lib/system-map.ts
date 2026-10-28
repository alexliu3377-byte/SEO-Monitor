export type SystemMapNode = {
  id: string
  title: string
  location: string
  summary: string
  details: string
  evidence: string[]
}

export type SystemMapView = {
  id: string
  title: string
  description: string
  lanes: { title: string; nodes: SystemMapNode[] }[]
  note: string
}

// Documentation snapshot, intentionally independent of runtime credentials and APIs.
export const SYSTEM_MAP: SystemMapView[] = [
  {
    id: 'overview', title: '系统总览',
    description: '从使用入口到数据存储，查看网站与后台采集的分工。箭头表示这一行的主要数据方向。',
    lanes: [
      { title: '网站访问', nodes: [
        { id: 'user', title: '管理员与组员', location: '浏览器', summary: '使用内容管理与应用更新功能', details: '用户通过登录进入工作台；菜单与数据范围按角色和分组控制。系统地图仅向超级管理员开放。', evidence: ['components/sidebar.tsx', 'lib/task-group-access.ts'] },
        { id: 'web', title: '奇心网站', location: 'Vercel · Next.js', summary: '页面、权限校验与业务 API', details: '服务端处理身份与权限、查询数据并返回页面。网站请求和接口计算影响 Vercel 用量；采集电脑的浏览器占用属于另一处运行资源。', evidence: ['app/(dashboard)/layout.tsx', 'lib/get-user-profile.ts', 'app/api/'] },
        { id: 'db', title: '认证与业务数据', location: 'Supabase', summary: '保存账号、采集结果和业务记录', details: '网站使用 Supabase 认证与数据库。浏览器不能持有服务端密钥；数据库结构变更应通过审查后的迁移，不能直接执行不完整的历史 schema.sql。', evidence: ['lib/supabase-server.ts', 'supabase/migrations/', 'docs/REVIEW_AND_RELEASE.md'] },
      ] },
      { title: '后台供数', nodes: [
        { id: 'actions', title: '定时与手动调度', location: 'GitHub Actions', summary: '启动 SEO 与内容采集工作流', details: '任务由 GitHub Actions 调度，不依赖旧电脑。各工作流的实际运行环境由 runs-on 决定；触发成功不代表每个数据步骤已经完成。', evidence: ['.github/workflows/daily-crawl.yml', '.github/workflows/content-feed-refresh.yml'] },
        { id: 'collectors', title: '采集执行环境', location: '云端 Runner / Windows Runner', summary: '读取外部平台并整理数据', details: 'SEO 脚本与 Windows 浏览器采集分工运行。16GB 电脑同时承担开发和部分采集，需要保持运行账号及采集环境可用。小红书、B 站、小黑盒的具体触发方式以 Worker 工作流为准。', evidence: ['scripts/', 'trend-collector-worker（独立仓库）/.github/workflows/'] },
        { id: 'ingestion', title: '数据入库与展示', location: '写入接口 / 数据库', summary: '采集结果供网站查询', details: 'Worker 通过受认证的接收接口提交结果；部分项目脚本直接写入数据库。网站随后查询结果或缓存；查看本地图不会启动采集或刷新缓存。', evidence: ['app/api/', 'scripts/', 'lib/group-tracking-cache.ts'] },
      ] },
    ],
    note: '这是代码结构说明，不是实时监控。线上版本、任务成功率和 CPU 用量需要另外核实。',
  },
  {
    id: 'collection', title: '采集与检查',
    description: '区分 SEO 数据处理和 Windows 内容采集，定位问题时先确认失败发生在哪一段。',
    lanes: [
      { title: 'SEO 数据', nodes: [
        { id: 'seo-trigger', title: '触发采集', location: 'GitHub Actions', summary: '每日任务、补采与重试', details: '工作流支持不同的采集任务。调度时间使用工作流配置的时区规则，不能把计划时间当成实际完成时间。', evidence: ['.github/workflows/daily-crawl.yml', '.github/workflows/supplement-crawl.yml', '.github/workflows/retry-crawl.yml'] },
        { id: 'seo-process', title: '采集与派生计算', location: '项目脚本', summary: '关键词、权重、排名、标题与收录', details: '采集原始数据后再执行派生处理及缓存更新。步骤完成记录用于识别缺失，避免只看到工作流成功就认为所有站点的数据齐全。', evidence: ['.github/workflows/derived-crawl-data.yml', 'lib/crawl-rules.ts'] },
        { id: 'seo-health', title: '只读完整性检查', location: '健康检查工作流', summary: '检查步骤完成和来源新鲜度', details: '检查包含 tracking 在内的六类 SEO 步骤及数据来源新鲜度。缺失数据会报告失败；检查本身不执行补采或写入修复。', evidence: ['.github/workflows/collection-readonly-check.yml', 'tools/crawlee-trial/health.mjs'] },
      ] },
      { title: '内容来源', nodes: [
        { id: 'worker', title: '平台采集', location: 'Windows · 独立 Worker', summary: 'B 站、小黑盒等浏览器任务', details: '浏览器采集依赖这台电脑、登录态和平台可访问性。小红书保持独立触发方式，不应把所有来源都理解为每日自动运行。', evidence: ['trend-collector-worker（独立仓库）/.github/workflows/'] },
        { id: 'transcript', title: '资料整理与转写', location: 'Worker / Windows 后台任务', summary: '整理来源日期、正文与视频资料', details: '视频资料可能需要后续转写；采集完成不代表转写完成。未知来源日期不能伪造成当天发布，仍需保留原始来源供核验。', evidence: ['trend-collector-worker（独立仓库）', 'lib/crawl-rules.ts'] },
        { id: 'content-use', title: '研究与内容准备', location: '奇心工作台', summary: '查看资料、判断选题、分派任务', details: '资料最终用于研究与任务准备。AI 内容代理仍在试验阶段，本地图不将其标为已上线的自动发布链路。', evidence: ['app/(dashboard)/content/research/', 'scripts/local-content-agent.ts'] },
      ] },
    ],
    note: '排查顺序：工作流日志 → 对应采集步骤 → 数据日期与完整性 → 网站显示。电脑在线不等于采集任务正常。',
  },
  {
    id: 'release', title: '开发与发布',
    description: '代码进入正式网站前需要哪些步骤，以及结构变更与内容代理的边界。',
    lanes: [{ title: '代码交付', nodes: [
      { id: 'develop', title: '本地开发', location: 'Windows · 开发目录', summary: '修改代码并运行隔离验证', details: '现有 .env.local 连接正式 Supabase；开发和测试应使用经过验证的隔离配置。开发目录与采集运行目录应保持隔离，避免互相覆盖。', evidence: ['docs/LOCAL_DEVELOPMENT.md', 'scripts/start-local-dev.mjs'] },
      { id: 'review', title: '测试与审查', location: '开发分支', summary: '权限、功能、构建与业务规则', details: '先完成适用测试和差异审查，再根据授权提交与推送。审核技能是开发辅助工具，不代表网站里常驻运行着审核代理。', evidence: ['AGENTS.md', 'docs/REVIEW_AND_RELEASE.md', '.agents/skills/qixin-review/'] },
      { id: 'preview', title: '预览验证', location: 'Vercel Preview', summary: '检查页面与服务端行为', details: '分支推送与正式发布是不同阶段。预览通过仍需核实环境配置、权限及必要迁移，不能据此认定正式网站已经更新。', evidence: ['docs/REVIEW_AND_RELEASE.md'] },
      { id: 'production', title: '正式发布与复核', location: '主分支 / 生产环境', summary: '授权后发布并核实线上结果', details: '合并和部署按发布流程进行；数据库迁移单独审查与授权。上线后检查实际版本、错误、采集状态及 CPU 用量。', evidence: ['docs/REVIEW_AND_RELEASE.md', 'supabase/migrations/'] },
    ] }],
    note: 'AI 内容代理与自动发布暂缓。地图描述现有分工，不会触发部署、数据库迁移或任何后台任务。',
  },
]
