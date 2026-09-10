-- Publish the completed v2.4.0 product changes while keeping the trend and
-- application-update work visibly separated as experiments.
begin;

alter table public.development_releases
  add column if not exists experimental_features jsonb not null default '[]'::jsonb;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'development_releases_experimental_features_check'
      and conrelid = 'public.development_releases'::regclass
  ) then
    alter table public.development_releases
      add constraint development_releases_experimental_features_check
      check (jsonb_typeof(experimental_features) = 'array');
  end if;
end
$$;

insert into public.development_releases (
  version, title, release_date, status, summary, highlights,
  experimental_features, implementation_notes, limitations,
  deployment_range, source_note
) values (
  'v2.4.0',
  '后台分层、反馈协作与实验工作区',
  '2026-09-10',
  'completed',
  '把近期已经完成但尚未完整归档的协作与维护改进整理为正式版本，并建立与内容运营后台分开的实验工作区，让新方向可以在线试用、持续调整，而不与已稳定功能混在一起。',
  '["反馈入口改为按钮，留言板使用整齐的列表、筛选和未读优先排序", "反馈详情改为聊天式沟通，并保留完整问题、相关页面和站点资料", "新增站点提交，组员和管理员可提交候选站点供超管审核", "项目负责人可更新处理进度并删除完全无关的反馈", "开发日志以版本号为重点，统一展开交接说明并改善编辑弹窗", "内部备注改为所有超管可读、仅项目负责人可编辑", "为超管实验功能建立独立后台入口，与内容运营菜单分开"]'::jsonb,
  '["趋势发现：小红书与抖音低频采集、候选词评分及采集词设置，目前继续观察数据价值和账号稳定性。", "应用更新中心：登记公开更新来源、识别版本与更新日志、人工审核和批量导出，目前继续验证不同站点的识别准确率。"]'::jsonb,
  '["反馈列表由服务端分页、筛选并计算留言数量与每位用户的未读状态。", "普通反馈采用公开留言板范围，回复权限仍限制为提交者与项目负责人；超管重点沟通保持独立范围。", "实验工作区继续使用现有登录体系，但页面、API 和数据库访问同时检查超管权限。", "趋势采集由已登录的本地浏览器低频执行；应用更新页面读取由独立 GitHub Actions 手动任务执行。"]'::jsonb,
  '["趋势发现仍依赖专用电脑保持平台登录，遇到验证或访问频繁会停止。", "应用更新页面结构并不统一，自动识别结果必须经过人工审核。", "两项实验功能尚不代表正式稳定能力，使用方式和数据结构仍可能继续调整。"]'::jsonb,
  '2026-09-04 至 2026-09-10',
  '这段时间连续处理了反馈沟通、版本记录和实验功能入口，但它们没有被完整归入一个新版本。我希望先把已经稳定使用的协作改进正式整理出来，同时让趋势发现和应用更新中心保留清楚的实验标记，方便线上试用后再决定正式方案。'
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
  source_note = excluded.source_note
where development_releases.created_by is null;

commit;
