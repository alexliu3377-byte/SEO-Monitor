-- Demo-only feedback board records. This file intentionally lives outside
-- migrations, so normal database migrations never seed preview data.
-- Every row has a fixed UUID and an explicit [演示] title, so the script can
-- be run repeatedly without creating duplicates. Deleting the five request
-- UUIDs also removes their messages.
begin;

do $$
declare
  v_owner_id uuid;
  v_owner_name text;
  v_normal_id uuid;
  v_normal_name text;
  v_admin_id uuid;
  v_admin_name text;
  v_super_id uuid;
  v_super_name text;
begin
  select id, coalesce(nullif(username, ''), '项目负责人')
  into v_owner_id, v_owner_name
  from public.user_profiles
  where id = '294f63a9-7c06-455f-9896-0fbc6344cee5'::uuid
  limit 1;

  select id, coalesce(nullif(username, ''), '演示组员')
  into v_normal_id, v_normal_name
  from public.user_profiles
  where role = 'normal' and is_active is distinct from false
  order by id
  limit 1;

  select id, coalesce(nullif(username, ''), '演示组长')
  into v_admin_id, v_admin_name
  from public.user_profiles
  where role = 'admin' and is_active is distinct from false
  order by id
  limit 1;

  select id, coalesce(nullif(username, ''), '演示超管')
  into v_super_id, v_super_name
  from public.user_profiles
  where role = 'super'
    and is_active is distinct from false
    and id <> '294f63a9-7c06-455f-9896-0fbc6344cee5'::uuid
  order by id
  limit 1;

  v_owner_name := coalesce(v_owner_name, '项目负责人');
  v_normal_name := coalesce(v_normal_name, '演示组员');
  v_admin_name := coalesce(v_admin_name, '演示组长');
  v_super_id := coalesce(v_super_id, v_owner_id);
  v_super_name := coalesce(v_super_name, v_owner_name, '演示超管');

  insert into public.development_requests (
    id, title, details, status, created_by, created_by_name,
    submitter_role, feedback_type, related_page, created_at, updated_at
  ) values (
    '10000000-0000-4000-8000-000000000001'::uuid,
    '[演示] 手机端认领按钮偶尔被内容遮挡',
    '在手机上打开任务工作台并切换到竞品涨排名时，部分较长关键词会靠近认领按钮，希望检查小屏幕下的间距和点击区域。',
    'pending', v_normal_id, v_normal_name,
    'normal', 'bug', 'task-groups', now() - interval '35 minutes', now() - interval '35 minutes'
  ) on conflict (id) do nothing;

  insert into public.development_requests (
    id, title, details, status, owner_response, created_by, created_by_name,
    submitter_role, feedback_type, related_page, created_at, updated_at
  ) values (
    '10000000-0000-4000-8000-000000000002'::uuid,
    '[演示] 成效报告筛选后希望保留选择',
    '组长查看不同成员的成效后返回上一页，筛选条件会恢复默认。希望短时间内返回时保留成员和成效类型，减少重复操作。',
    'in_progress',
    '已确认这个操作会增加重复点击，准备先保留当前页面的筛选条件，再评估是否需要跨登录保存。',
    v_normal_id, v_normal_name,
    'normal', 'usability', 'group-report', now() - interval '2 days', now() - interval '3 hours'
  ) on conflict (id) do nothing;

  insert into public.development_requests (
    id, title, details, status, owner_response, created_by, created_by_name,
    submitter_role, feedback_type, related_page, submitted_site, created_at, updated_at
  ) values (
    '10000000-0000-4000-8000-000000000003'::uuid,
    '[演示] 建议加入新的竞品内容站',
    '这个站点近期经常发布与软件下载相关的内容，更新频率较高。建议先审核栏目结构和抓取稳定性，再决定是否加入竞品日收与关键词追踪。',
    'accepted',
    '已收到站点，下一步会检查页面结构、更新频率及是否存在访问限制。',
    v_admin_id, v_admin_name,
    'admin', 'site_submission', 'sites', 'demo-site.example.com', now() - interval '3 days', now() - interval '1 day'
  ) on conflict (id) do nothing;

  insert into public.development_requests (
    id, title, details, status, owner_response, created_by, created_by_name,
    submitter_role, feedback_type, related_page, created_at, updated_at, completed_at
  ) values (
    '10000000-0000-4000-8000-000000000004'::uuid,
    '[演示] 抓取失败时需要更清楚的原因',
    '以前抓取结果为空时，不容易判断是网站没有数据、Cookie 失效还是遇到验证。希望日志能直接区分原因并给出下一步处理建议。',
    'completed',
    '已经把失败原因分为网络、验证、解析和空结果，并保留重试入口。后续遇到相同情况可以直接从抓取日志判断。',
    v_admin_id, v_admin_name,
    'admin', 'data', 'crawl-log', now() - interval '8 days', now() - interval '5 days', now() - interval '5 days'
  ) on conflict (id) do nothing;

  insert into public.development_requests (
    id, title, details, status, created_by, created_by_name,
    submitter_role, feedback_type, related_page, created_at, updated_at
  ) values (
    '10000000-0000-4000-8000-000000000005'::uuid,
    '[演示] 调研短视频与内容社区的选题信号',
    '希望评估小红书、抖音和小黑盒是否存在可持续取得的公开内容信号，先确认接口、授权、频率和合规限制，再决定是否做小范围试行。',
    'researching', v_super_id, v_super_name,
    'super', 'feature', 'research', now() - interval '4 days', now() - interval '6 hours'
  ) on conflict (id) do nothing;

  insert into public.development_request_messages (
    id, request_id, author_id, author_name, author_role, message_type, content, created_at
  ) values
  (
    '20000000-0000-4000-8000-000000000001'::uuid,
    '10000000-0000-4000-8000-000000000002'::uuid,
    v_normal_id, v_normal_name, 'normal', 'discussion',
    '我最常用的是成员和成效类型两个筛选，切换站点后可以恢复默认，但返回列表时希望保留。',
    now() - interval '1 day'
  ),
  (
    '20000000-0000-4000-8000-000000000002'::uuid,
    '10000000-0000-4000-8000-000000000002'::uuid,
    v_owner_id, v_owner_name, 'super', 'discussion',
    '了解，我会先按“同一站点内返回时保留”处理，切换站点则清空，避免把不适用的成员条件带过去。',
    now() - interval '3 hours'
  ),
  (
    '20000000-0000-4000-8000-000000000003'::uuid,
    '10000000-0000-4000-8000-000000000003'::uuid,
    v_admin_id, v_admin_name, 'admin', 'discussion',
    '这个站主要想观察软件下载栏目，不需要先抓整个网站。',
    now() - interval '2 days'
  ),
  (
    '20000000-0000-4000-8000-000000000004'::uuid,
    '10000000-0000-4000-8000-000000000003'::uuid,
    v_owner_id, v_owner_name, 'super', 'discussion',
    '收到，我会先检查该栏目的列表分页和详情链接是否稳定，再决定加入哪一种追踪。',
    now() - interval '1 day'
  ),
  (
    '20000000-0000-4000-8000-000000000005'::uuid,
    '10000000-0000-4000-8000-000000000005'::uuid,
    v_super_id, v_super_name, 'super', 'research',
    '初步资料显示各平台的公开接口、登录要求和数据范围不同，不能直接用同一种采集方式处理。建议先整理每个平台真正需要的字段。',
    now() - interval '2 days'
  ),
  (
    '20000000-0000-4000-8000-000000000006'::uuid,
    '10000000-0000-4000-8000-000000000005'::uuid,
    v_owner_id, v_owner_name, 'super', 'experiment',
    '准备先用少量公开页面验证内容质量和更新频率，不接入账号，也不做高频抓取；结果有价值后再讨论正式方案。',
    now() - interval '6 hours'
  )
  on conflict (id) do nothing;
end
$$;

commit;

-- Cleanup when the preview is no longer needed (messages cascade-delete):
-- delete from public.development_requests where id in (
--   '10000000-0000-4000-8000-000000000001'::uuid,
--   '10000000-0000-4000-8000-000000000002'::uuid,
--   '10000000-0000-4000-8000-000000000003'::uuid,
--   '10000000-0000-4000-8000-000000000004'::uuid,
--   '10000000-0000-4000-8000-000000000005'::uuid
-- );
