-- Development milestones and super-admin product requests.
-- Version rule: x.0.0 = a new product stage; x.y.0 = an important feature set;
-- x.y.z = a smaller permission, performance, stability or UI improvement.
begin;

create table if not exists public.development_releases (
  id uuid primary key default gen_random_uuid(),
  version text not null unique,
  title text not null,
  release_date date not null,
  status text not null default 'completed'
    check (status in ('completed', 'in_progress', 'planned')),
  summary text not null,
  highlights jsonb not null default '[]'::jsonb check (jsonb_typeof(highlights) = 'array'),
  implementation_notes jsonb not null default '[]'::jsonb check (jsonb_typeof(implementation_notes) = 'array'),
  limitations jsonb not null default '[]'::jsonb check (jsonb_typeof(limitations) = 'array'),
  deployment_range text,
  source_note text,
  created_by uuid references public.user_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.development_requests (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  details text not null,
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'in_progress', 'completed', 'blocked', 'declined')),
  problem_details text,
  owner_response text,
  created_by uuid references public.user_profiles(id) on delete set null,
  created_by_name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists development_releases_date_idx on public.development_releases (release_date desc, version desc);
create index if not exists development_requests_status_date_idx on public.development_requests (status, created_at desc);

create or replace function public.touch_development_log_updated_at()
returns trigger language plpgsql set search_path = pg_catalog, public
as $$
begin
  new.updated_at = now();
  return new;
end
$$;

drop trigger if exists touch_development_releases_updated_at on public.development_releases;
create trigger touch_development_releases_updated_at before update on public.development_releases
  for each row execute function public.touch_development_log_updated_at();
drop trigger if exists touch_development_requests_updated_at on public.development_requests;
create trigger touch_development_requests_updated_at before update on public.development_requests
  for each row execute function public.touch_development_log_updated_at();

alter table public.development_releases enable row level security;
alter table public.development_requests enable row level security;
revoke all on table public.development_releases from public, anon, authenticated;
revoke all on table public.development_requests from public, anon, authenticated;
grant all on table public.development_releases to service_role;
grant all on table public.development_requests to service_role;
revoke all on function public.touch_development_log_updated_at() from public;

-- Milestones inferred from Git history and GitHub's Vercel deployment records.
-- Debug deployments are intentionally grouped into product-relevant releases.
insert into public.development_releases (
  version, title, release_date, status, summary, highlights,
  implementation_notes, limitations, deployment_range, source_note
) values
(
  'v1.0.0', '站点监控基础版', '2026-06-08', 'completed',
  '建立第一套可持续保存的站点资料与抓取结果，系统从人工查看网页变成每天自动记录。',
  '["网站管理：集中维护域名与抓取设置", "爱站权重与基础关键词采集", "Supabase 保存每日结果与历史变化", "首页提供站点状态概览"]'::jsonb,
  '["服务端请求目标页面并解析 HTML，再把结构化结果写入数据库。", "界面读取已经保存的数据，不会等用户打开页面才进行整批抓取。"]'::jsonb,
  '["第三方网页改版后可能需要同步修改解析规则。", "爱站出现 Cookie 验证时可能返回空结果而不是真实的零数据。"]'::jsonb,
  '2026-06-08 至 2026-06-09', '依据 Git 提交与 Vercel 部署记录归纳'
),
(
  'v1.1.0', '抓取日志、排名变化与稳定性', '2026-06-18', 'completed',
  '补上抓取过程的可见性，并开始比较前后排名，让维护者知道任务是成功、空结果还是失败。',
  '["抓取日志与失败详情", "排名上升、下降及历史变化", "分页采集与多个 HTML 来源兼容", "GBK 页面编码支持", "超时、错峰与基础重试"]'::jsonb,
  '["任务按站点分批，避免一次请求承担全部网站。", "日志保存步骤、站点、耗时和写入数量，便于针对失败站点补抓。"]'::jsonb,
  '["空结果可能来自验证、网络或页面结构改变，需要结合日志判断。"]'::jsonb,
  '2026-06-09 至 2026-06-18', '依据抓取日志与排名相关部署归纳'
),
(
  'v1.2.0', '收录监控与竞品日收', '2026-06-20', 'completed',
  '从权重与排名扩展到收录量和竞品新增内容，形成站点日常监控的完整基础。',
  '["网站收录量每日记录", "竞品当天新增内容采集", "收录变化与异常提示", "百度 site 查询的第一版尝试"]'::jsonb,
  '["收录和竞品数据按日期保存，可以比较今天、昨天和更长周期。", "百度直接查询曾尝试浏览器自动化，因验证成本和稳定性问题没有把绕过验证作为长期方案。"]'::jsonb,
  '["百度可能出现人机验证；自动化浏览器也不能保证稳定通过。", "无结果不能一律当作未收录，必须区分验证失败与真实结果。"]'::jsonb,
  '2026-06-19 至 2026-06-20', '依据收录监控与竞品日收部署归纳'
),
(
  'v1.3.0', 'GitHub Actions 定时抓取架构', '2026-06-24', 'completed',
  '把长时间抓取从 Vercel 函数迁移到 GitHub Actions，支持更长执行时间、分组运行与失败重试。',
  '["定时抓取改由 GitHub Actions 执行", "站点矩阵分组与并行任务", "失败站点自动进入 retry 工作流", "抓取结束后统一整理任务状态"]'::jsonb,
  '["Vercel 继续负责网页和短 API；GitHub Actions 负责耗时抓取。", "GitHub 执行器的出口 IP 会变化。分组运行能分散压力，但不能承诺固定 IP，也不能消除目标站点限流。", "并发和请求间隔必须保留，不能因为执行器 IP 不固定就无限增加访问量。"]'::jsonb,
  '["GitHub Actions 有并发与使用额度限制。", "外部站点仍可针对频率、Cookie、IP 或行为触发验证。"]'::jsonb,
  '2026-06-21 至 2026-06-25', '依据 cron 迁移与工作流部署归纳'
),
(
  'v1.4.0', '热词雷达与内容信号', '2026-06-27', 'completed',
  '把监控数据整理为可行动信号，帮助内容人员发现近期上升、多个站点共同出现及值得跟进的词。',
  '["热词雷达", "连续上升信号", "多站点共享词信号", "按变化、排名、搜索量和时间筛选", "热词榜单与缓存"]'::jsonb,
  '["系统从历史采集结果计算趋势，再缓存整理后的信号，减少每次打开页面的重复计算。", "信号用于辅助选题，不等同于自动判断内容价值。"]'::jsonb,
  '["搜索量、排名和权重仍受第三方更新频率影响。", "缓存显示最近一次成功计算结果，不一定是实时值。"]'::jsonb,
  '2026-06-27 至 2026-06-30', '依据热词雷达相关部署归纳'
),
(
  'v1.5.0', '百度收录页与 Cookie 轮换池', '2026-07-17', 'completed',
  '在无法可靠绕过百度验证的前提下，引入可维护的 Cookie 池，并完善具体收录页面追踪。',
  '["百度收录页面记录", "多页查询与会话保持", "Cookie 轮换池", "手动补充有效 Cookie", "失效 Cookie 删除与失败补抓"]'::jsonb,
  '["查询使用 Cookie 池轮换；某个 Cookie 失效或遇到验证后，可继续尝试池内其他 Cookie。", "Cookie 由登录组员共同新增和删除，方便日常维护。", "抓取任务进一步拆分站点组，降低单一执行过程的连续请求密度。"]'::jsonb,
  '["百度会按频率、Cookie、出口 IP 和行为触发人机验证，系统不能保证每次查询成功。", "Cookie 不是永久凭证，需要定期补充并删除旧 Cookie。"]'::jsonb,
  '2026-07-03 至 2026-07-28', '依据百度收录与 Cookie 管理部署归纳'
),
(
  'v2.0.0', '分组协作与内容研究平台', '2026-08-07', 'completed',
  '系统从“看监控数据”进入新的大版本：支持分组认领、成果提交与追踪，并把长期数据沉淀到研究中心。',
  '["任务工作台与站点分组", "推荐词、词库词和分发词认领", "提交 URL、最终词与操作类型", "成效报告与追踪总汇", "研究中心、站点诊断与竞品研究", "按组员和管理范围区分资料"]'::jsonb,
  '["每次认领生成独立记录，后续收录和排名通过 claim_id 关联，保留工作归属。", "组员只看自己；管理员看负责站点的组员；超管按系统权限查看。", "研究中心把已有历史数据汇总成周、月、季度和专题分析。"]'::jsonb,
  '["成果需要先正确认领和提交，后续抓取才能建立稳定关联。", "第三方收录与排名数据异常时，成效也会延迟更新。"]'::jsonb,
  '2026-06-30 至 2026-08-07', '依据分组任务、成效报告与研究中心部署归纳'
),
(
  'v2.1.0', '每日缓存与大数据页面加速', '2026-08-18', 'completed',
  '为热词雷达、分组报告和首页统计增加定时缓存，降低重复 Supabase 查询和浏览器计算量。',
  '["热词雷达每日缓存", "分组报告每日缓存", "超过 3000 行的数据改为完整分页读取", "缓存刷新失败时保留旧结果"]'::jsonb,
  '["每日抓取完成后生成一次汇总，用户打开页面主要读取缓存。", "缓存写入完成后再切换，避免刷新过程中页面突然空白。"]'::jsonb,
  '["缓存提高速度但有更新时间；最新提交可能要等下一次刷新。"]'::jsonb,
  '2026-08-11 至 2026-08-18', '依据缓存和分页修复部署归纳'
),
(
  'v2.2.0', '研究中心深化与商业词研究', '2026-08-28', 'completed',
  '增加季度分析、环境分段、商业关键词与覆盖研究，让历史数据能用于更长期的内容决策。',
  '["季度研究报告", "环境异常日与阶段划分", "商业关键词发现", "站点覆盖分析", "竞品追踪结果进入研究资料"]'::jsonb,
  '["环境异常日会从部分成效评分中排除，减少全站波动对个人成果判断的干扰。", "Actions 并发数根据 GitHub 同时任务限制重新调整。"]'::jsonb,
  '["研究结论是数据辅助，需要业务人员结合实际内容与行业变化判断。"]'::jsonb,
  '2026-08-20 至 2026-08-28', '依据研究报告和商业词部署归纳'
),
(
  'v2.3.0', '工作台、成效报告与站点权限重构', '2026-09-03', 'completed',
  '重新整理分组入口和报告层级，并让管理员可以负责一个或多个站点，只查看职责范围内的全部组员资料。',
  '["分组列表与独立工作台路由", "成效报告按站点进入", "管理员多站点负责范围", "组员、管理员和超管的报告范围", "Cookie 管理恢复为组员共同维护"]'::jsonb,
  '["页面可见性与 API 权限同时检查，不能只依赖隐藏按钮。", "分组名称和切换器保持当前工作上下文，避免一次加载全部分组的大量资料。"]'::jsonb,
  '["管理员负责站点需要在账户设置中正确配置，否则不会看到对应分组。"]'::jsonb,
  '2026-09-03', '依据分组页面与权限重构部署归纳'
),
(
  'v2.3.1', '数据库与接口审计加固', '2026-09-03', 'completed',
  '根据完整项目审计补强数据约束、接口鉴权、姓名回退与并发认领保护。',
  '["重复认领并发保护", "用户名与成员关系唯一性约束", "关键字段非空约束", "成效姓名从 user_profiles 回退，避免显示 UUID", "首页搜索量导出限定项目负责人"]'::jsonb,
  '["数据库迁移遇到历史重复数据时优先保留业务记录，并阻止新的重复写入。", "服务端接口重新核对登录、角色与数据范围。"]'::jsonb,
  '["数据库迁移必须先在 Supabase 执行，再部署依赖新结构的代码。"]'::jsonb,
  '2026-09-03', '依据 Extra High 项目与数据库审计归纳'
),
(
  'v2.3.2', '抓取后处理链与系统更名', '2026-09-04', 'completed',
  '每日 SEO crawl retry 完成后立即运行 tracking、环境快照、热词缓存和分组报告缓存，并将产品名称改为“奇心内容发布系统”。',
  '["四项后处理任务改为抓取完成后串联", "减少固定间隔造成的等待", "系统名称与页面品牌更新", "抓取日志不再记录普通搜索操作"]'::jsonb,
  '["后处理读取本站数据库，不会额外大量访问外部网站。", "依赖任务使用 workflow 结果衔接，失败时仍可从日志定位具体步骤。"]'::jsonb,
  '["上游抓取延迟会顺延后处理开始时间。"]'::jsonb,
  '2026-09-04', '依据工作流与品牌更新部署归纳'
),
(
  'v2.3.3', '离职办理与分组报告分页缓存', '2026-09-04', 'completed',
  '补上员工离职的安全流程，并把大型成效追踪缓存拆成数据库端分页，解决单个超大 JSON 读取缓慢的问题。',
  '["停用账号并禁止登录", "自动退出分组和撤销站点权限", "保留用户名、历史成果和追踪记录", "成效明细服务端分页、筛选与排序", "旧缓存兼容与完整性检查"]'::jsonb,
  '["离职不直接删除 user_profiles，避免历史报告失去姓名与归属。", "报告每次只返回当前页，统计在数据库缓存表中完成。"]'::jsonb,
  '["需先运行 user_offboarding 与 group_tracking_paged_cache 两个数据库迁移。"]'::jsonb,
  '2026-09-04', '依据离职流程与报告性能部署归纳'
),
(
  'v2.3.4', '开发日志与意见跟踪', '2026-09-04', 'completed',
  '建立面向接班人与管理层的版本说明，并让超管可以提交需求、查看评估进度和遇到的问题。',
  '["版本开发时间线", "实现方式与维护限制说明", "超管意见提交", "待评估、开发中、完成、遇到问题等状态", "项目负责人回复与问题详情"]'::jsonb,
  '["管理层看到的是经过归纳的产品版本，不是每次调试部署。", "管理员和超管可阅读；只有超管可提议；只有项目负责人可维护版本和处理状态。"]'::jsonb,
  '["历史版本由部署和提交记录推算，日期代表阶段完成时间，不等于每个功能只有一次部署。"]'::jsonb,
  '2026-09-04', '依据 954 次可追溯 Vercel 部署与 Git 历史归纳'
)
on conflict (version) do update set
  title = excluded.title,
  release_date = excluded.release_date,
  status = excluded.status,
  summary = excluded.summary,
  highlights = excluded.highlights,
  implementation_notes = excluded.implementation_notes,
  limitations = excluded.limitations,
  deployment_range = excluded.deployment_range,
  source_note = excluded.source_note
where development_releases.created_by is null;

commit;
