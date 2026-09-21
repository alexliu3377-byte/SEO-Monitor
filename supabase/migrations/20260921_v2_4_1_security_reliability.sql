-- Publish the security, reliability and daily-workflow improvements completed
-- after v2.4.0. Marketplace and trend collection remain clearly experimental.
begin;

insert into public.development_releases (
  version, title, release_date, status, summary, highlights,
  experimental_features, implementation_notes, limitations,
  deployment_range, source_note
) values (
  'v2.4.1',
  '安全加固、数据完整性与工作台优化',
  '2026-09-21',
  'completed',
  '加强后台登录后的请求边界、接口响应和自动任务安全，并集中修复近期影响日常使用的数据缺失、加载缓慢、历史资料查看和任务筛选问题。应用更新与商业词实验功能也完成一轮可用性提升，但仍保留实验属性。',
  '["增加登录态 API 的跨站写请求保护，并补充 API 禁止缓存与同源安全响应头", "加固带有高权限密钥的 GitHub Actions 输入处理，限制补抓范围并采用最小工作流权限", "任务提交各资料标签统一支持全部、新增和更新筛选，并可按历史日期查看遗漏内容", "扩大任务工作台可视区域，简化筛选栏和日期浏览操作", "修复成效追踪重试超时、工作流步骤识别和缓存分组读取问题，降低历史资料缺失风险", "应用更新列表改为数据库分页，同一应用只显示最新版本，历史版本集中到详情中", "应用更新支持来源筛选、整页或全部结果选择及批量导出", "商业词新词可在词组详情直接加入；忽略词进入永久排除名单，不再重复发现", "商业词排名覆盖增加搜索量、同名词聚合排序和完整分页读取", "离职成员的停用日期改为同行展示，同时继续保留历史成效资料"]'::jsonb,
  '["应用更新中心：扩展 App Store 历史版本与游戏目录，并尝试 Google Play、TapTap 等公开市场来源；继续验证资料完整性、抓取稳定性和更新频率。", "趋势发现：继续以低频本地采集验证小红书和抖音公开内容信号，暂不作为正式稳定数据源。"]'::jsonb,
  '["所有生产与开发依赖已经过 npm 漏洞库检查，本次检查未发现已知漏洞。", "未登录访问用户、站点、应用更新、定时任务和采集配置等敏感接口会返回 401。", "外部抓取地址继续限制协议、端口、私网地址及重定向目标，降低服务端请求伪造风险。", "应用更新列表由 PostgreSQL 完成筛选、去重和分页，避免一次传输全部历史记录。", "排名与追踪读取改用稳定排序的分批分页查询，避免 Supabase 单次返回上限造成静默缺失。", "商业词忽略操作只保留规范化排除词，删除体积较大的发现证据；后续排名抓取会在写入前跳过排除词。", "安全审查结果记录在 docs/security-review-2026-09-21.md，自动化渗透测试将先在受限 Preview 环境验证。"]'::jsonb,
  '["Strix 等主动渗透工具尚未直接用于生产环境；后续应先建立使用测试账号和脱敏数据的 Preview 环境。", "登录限流目前同时依赖 Cloudflare Turnstile 与应用内计数；若未来扩大外部用户范围，应增加平台或数据库级全局限流。", "应用市场页面结构和公开接口可能变化，自动获取的版本与更新日志仍需人工抽查。", "趋势采集仍依赖专用电脑保持平台登录，遇到验证或访问限制时可能中断。"]'::jsonb,
  '2026-09-11 至 2026-09-21',
  '这一阶段不只是增加实验数据来源，也集中解决了大家实际使用时遇到的历史资料难找、列表加载缓慢、重抓超时和数据看起来不完整等问题。版本同时补上基础安全检查与自动任务防护，让现有后台在继续扩展前先拥有更稳固的运行基础。'
)
on conflict (version) do update set
  title = excluded.title,
  release_date = excluded.release_date,
  status = excluded.status,
  summary = excluded.summary,
  highlights = excluded.highlights,
  experimental_features = excluded.experimental_features,
  implementation_notes = excluded.implementation_notes,
  limitations = excluded.limitations,
  deployment_range = excluded.deployment_range,
  source_note = excluded.source_note,
  updated_at = now()
where development_releases.created_by is null;

commit;
