-- Feedback board preview data for the table, filters, unread badges and delete
-- confirmation. Run manually in Supabase SQL Editor; this is not a migration.
-- Fixed UUIDs make the script safe to run more than once.
begin;

do $$
declare
  v_owner_id uuid := '294f63a9-7c06-455f-9896-0fbc6344cee5'::uuid;
  v_owner_name text := '项目负责人';
  v_normal_id uuid;
  v_normal_name text := '演示组员';
  v_admin_id uuid;
  v_admin_name text := '演示组长';
  v_super_id uuid;
  v_super_name text := '演示超管';
begin
  select id, coalesce(nullif(username, ''), v_owner_name)
    into v_owner_id, v_owner_name
  from public.user_profiles
  where id = v_owner_id
  limit 1;

  v_owner_name := coalesce(v_owner_name, '项目负责人');

  insert into public.development_requests (
    id, title, details, status, created_by, created_by_name,
    submitter_role, feedback_type, related_page, submitted_site, created_at, updated_at
  ) values
  (
    '11000000-0000-4000-8000-000000000001'::uuid,
    '[演示] 任务工作台按钮在窄屏幕上太拥挤',
    '组员使用较小的笔记本窗口时，任务工作台右侧按钮与关键词内容距离太近，希望调整列宽和点击区域。',
    'pending', v_normal_id, v_normal_name,
    'normal', 'bug', 'task-groups', null, now() - interval '25 minutes', now() - interval '25 minutes'
  ),
  (
    '11000000-0000-4000-8000-000000000002'::uuid,
    '[演示] 成效报告返回后希望保留筛选条件',
    '组长连续查看几位成员的成效时，每次返回列表都要重新选择成员和成效类型，希望短时间内保留筛选。',
    'in_progress', v_normal_id, v_normal_name,
    'normal', 'usability', 'group-report', null, now() - interval '2 days', now() - interval '2 days'
  ),
  (
    '11000000-0000-4000-8000-000000000003'::uuid,
    '[演示] 建议审核一个新的竞品内容站',
    '这个站点的软件栏目更新较频繁，希望先检查页面结构和抓取稳定性，再决定是否加入竞品日收与关键词追踪。',
    'accepted', v_admin_id, v_admin_name,
    'admin', 'site_submission', 'sites', 'demo-competitor.example.com', now() - interval '3 days', now() - interval '3 days'
  ),
  (
    '11000000-0000-4000-8000-000000000004'::uuid,
    '[演示] 抓取日志已经可以区分失败原因',
    '以前空结果无法区分无数据、Cookie 失效和人机验证，现在希望在列表中保留处理完成的结果供大家参考。',
    'completed', v_admin_id, v_admin_name,
    'admin', 'data', 'crawl-log', null, now() - interval '7 days', now() - interval '1 day'
  ),
  (
    '11000000-0000-4000-8000-000000000005'::uuid,
    '[演示] 调研短视频与内容社区的选题信号',
    '评估小红书、抖音和小黑盒是否存在可持续取得的公开内容信号，先确认接口、授权、频率与合规限制。',
    'researching', v_super_id, v_super_name,
    'super', 'feature', 'research', null, now() - interval '4 days', now() - interval '4 days'
  ),
  (
    '11000000-0000-4000-8000-000000000006'::uuid,
    '[演示] 与系统完全无关的测试提交',
    '这是一条专门用于检查项目负责人删除按钮、二次确认弹窗以及级联清理效果的无关演示反馈。',
    'pending', v_normal_id, v_normal_name,
    'normal', 'other', null, null, now() - interval '5 minutes', now() - interval '5 minutes'
  )
  on conflict (id) do nothing;

  update public.development_requests
  set
    submitted_site = 'demo-competitor.example.com',
    owner_response = '已收到站点，准备检查栏目分页、更新频率和访问限制。'
  where id = '11000000-0000-4000-8000-000000000003'::uuid;

  update public.development_requests
  set
    owner_response = '已完成失败原因分类，并保留单站补跑入口。',
    completed_at = now() - interval '1 day'
  where id = '11000000-0000-4000-8000-000000000004'::uuid;

  insert into public.development_request_messages (
    id, request_id, author_id, author_name, author_role, message_type, content, created_at
  ) values
  (
    '21000000-0000-4000-8000-000000000001'::uuid,
    '11000000-0000-4000-8000-000000000002'::uuid,
    v_owner_id, v_owner_name, 'super', 'discussion',
    '我会先处理同一站点内返回时保留筛选；切换站点后仍恢复默认，避免带入不适用的成员。',
    now() - interval '1 day'
  ),
  (
    '21000000-0000-4000-8000-000000000002'::uuid,
    '11000000-0000-4000-8000-000000000002'::uuid,
    v_normal_id, v_normal_name, 'normal', 'discussion',
    '这样可以，最常用的是成员和成效类型两个筛选，希望返回列表时都保留。',
    now() - interval '20 minutes'
  ),
  (
    '21000000-0000-4000-8000-000000000003'::uuid,
    '11000000-0000-4000-8000-000000000003'::uuid,
    v_admin_id, v_admin_name, 'admin', 'discussion',
    '主要想观察软件下载栏目，不需要先抓取整个网站。',
    now() - interval '2 hours'
  ),
  (
    '21000000-0000-4000-8000-000000000004'::uuid,
    '11000000-0000-4000-8000-000000000004'::uuid,
    v_owner_id, v_owner_name, 'super', 'discussion',
    '日志现已区分网络、验证、解析和真实空结果，这条反馈可以作为完成案例保留。',
    now() - interval '1 day'
  ),
  (
    '21000000-0000-4000-8000-000000000005'::uuid,
    '11000000-0000-4000-8000-000000000005'::uuid,
    v_owner_id, v_owner_name, 'super', 'research',
    '初步资料显示各平台的公开接口、登录要求和数据范围不同，建议先明确真正需要的字段。',
    now() - interval '2 days'
  ),
  (
    '21000000-0000-4000-8000-000000000006'::uuid,
    '11000000-0000-4000-8000-000000000005'::uuid,
    v_super_id, v_super_name, 'super', 'discussion',
    '建议先用少量公开页面验证内容质量和更新频率，不接入账号，也不做高频采集。',
    now() - interval '45 minutes'
  )
  on conflict (id) do nothing;

  -- Make the preview badges visible again whenever this demo is rerun.
  delete from public.development_request_message_reads
  where request_id in (
    '11000000-0000-4000-8000-000000000001'::uuid,
    '11000000-0000-4000-8000-000000000002'::uuid,
    '11000000-0000-4000-8000-000000000003'::uuid,
    '11000000-0000-4000-8000-000000000004'::uuid,
    '11000000-0000-4000-8000-000000000005'::uuid,
    '11000000-0000-4000-8000-000000000006'::uuid
  );
end
$$;

commit;

-- Cleanup after reviewing the UI (linked messages/read states cascade-delete):
-- delete from public.development_requests where id in (
--   '11000000-0000-4000-8000-000000000001'::uuid,
--   '11000000-0000-4000-8000-000000000002'::uuid,
--   '11000000-0000-4000-8000-000000000003'::uuid,
--   '11000000-0000-4000-8000-000000000004'::uuid,
--   '11000000-0000-4000-8000-000000000005'::uuid,
--   '11000000-0000-4000-8000-000000000006'::uuid
-- );
