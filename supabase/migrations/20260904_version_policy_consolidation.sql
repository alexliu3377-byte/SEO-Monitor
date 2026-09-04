-- Keep the development log product-focused instead of mirroring every deploy.
-- Only untouched system-seeded rows are consolidated; manually edited releases
-- (created_by is not null) are preserved.
begin;

delete from public.development_releases
where version in ('v2.3.1', 'v2.3.2', 'v2.3.3', 'v2.3.4', 'v2.3.5')
  and created_by is null;

update public.development_releases
set
  title = '工作台、权限与数据库审计重构',
  summary = '重新整理分组入口和报告层级，明确组员、管理员及超管的资料范围，并完成数据库与接口安全审计。',
  highlights = '["分组列表与独立工作台路由", "成效报告按站点进入", "管理员可负责多个站点", "组员、管理员和超管的资料范围", "Cookie 管理恢复为组员共同维护", "重复认领保护、关键字段约束和接口鉴权", "成效姓名回退到 user_profiles，避免显示 UUID"]'::jsonb,
  implementation_notes = '["页面可见性与 API 权限同时检查，不能只依赖隐藏按钮。", "分组路由只加载当前工作台资料，避免一次读取所有分组。", "数据库保留历史业务记录，同时阻止新的重复和无归属写入。"]'::jsonb,
  limitations = '["管理员需要先在账户设置配置负责站点。", "数据库结构变更必须先执行迁移，再部署依赖新字段的代码。"]'::jsonb,
  deployment_range = '2026-09-03',
  source_note = '依据当日工作台、权限与 Extra High 审计相关提交统一归纳'
where version = 'v2.3.0'
  and created_by is null;

insert into public.development_releases (
  version, title, release_date, status, summary, highlights,
  implementation_notes, limitations, deployment_range, source_note
) values (
  'v2.3.1',
  '协作、维护与稳定性综合更新',
  '2026-09-04',
  'completed',
  '把当天围绕稳定性、人员管理、报告性能和团队沟通完成的多次部署，合并为一次对使用者有意义的版本更新。',
  '["抓取重试后串联 tracking、环境快照、热词和分组报告缓存", "系统更名为奇心内容发布系统", "员工离职改为停用账号并保留历史成果", "分组追踪改为服务端分页缓存", "开发日志与角色化反馈优化", "反馈类型、相关页面与提交额度", "超管重点沟通、调研、试行和决策记录"]'::jsonb,
  '["耗时抓取由 GitHub Actions 运行，页面读取 Supabase 中的已保存结果和缓存。", "反馈按组员、管理员、超管范围在服务端过滤。", "超管沟通只有展开某条重点反馈时才分页读取，避免列表产生多余查询。", "Git 提交与 Vercel 部署继续保留详细技术过程，开发日志只记录统一产品版本。"]'::jsonb,
  '["外部站点验证、GitHub Actions 配额和第三方页面变化仍可能造成当日数据不完整。", "调研资料与试行结果是决策依据，正式接入外部平台前仍需确认授权、接口、频率和合规限制。"]'::jsonb,
  '2026-09-04',
  '同日多次功能、修复和部署按一轮综合更新合并记录'
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
