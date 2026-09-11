-- Add the completed sidebar reorganization to the already-published v2.4.0
-- release record. The containment checks keep this patch safe to rerun.
begin;

update public.development_releases
set
  highlights = case
    when highlights @> '["内容系统侧栏改为任务工作台、趋势研究、站点情报和系统管理等可展开分组"]'::jsonb
      then highlights
    else highlights || '["内容系统侧栏改为任务工作台、趋势研究、站点情报和系统管理等可展开分组"]'::jsonb
  end,
  implementation_notes = case
    when implementation_notes @> '["内容侧栏按工作范围折叠，进入子页面时自动展开所属分组，并在过滤权限后隐藏空分组；返回系统首页与退出登录统一放在底部。"]'::jsonb
      then implementation_notes
    else implementation_notes || '["内容侧栏按工作范围折叠，进入子页面时自动展开所属分组，并在过滤权限后隐藏空分组；返回系统首页与退出登录统一放在底部。"]'::jsonb
  end,
  updated_at = now()
where version = 'v2.4.0'
  and created_by is null;

commit;
