-- A real rollout record, not demo data. Deployment is deliberately not claimed.
begin;
do $$
begin
  if not exists(select 1 from public.development_tasks where title='开发日志进度与发布归档') then
    perform public.save_development_task(null,0,'294f63a9-7c06-455f-9896-0fbc6344cee5',
      jsonb_build_object(
        'title','开发日志进度与发布归档',
        'description','根据负责人与领导沟通的要求，在原开发日志上增加事项进度、难题、检查项和测试记录；上线后可手动归入发布版本，同时保留完整开发过程。',
        'owner_name','项目负责人','stage','ready',
        'checklist',jsonb_build_array(
          jsonb_build_object('id','951d1f12-4a82-4228-9499-603ae0cc2511','text','独立的开发事项、阶段统计与检查项进度','done',true),
          jsonb_build_object('id','951d1f12-4a82-4228-9499-603ae0cc2512','text','保留难题、下一步和每次修改的完整快照','done',true),
          jsonb_build_object('id','951d1f12-4a82-4228-9499-603ae0cc2513','text','权限、并发编辑保护、测试与上线条件校验','done',true),
          jsonb_build_object('id','951d1f12-4a82-4228-9499-603ae0cc2514','text','桌面和手机交互验证、完整回归及生产构建','done',true)
        ),
        'blocker','',
        'next_step','等待代码部署成功，再检查线上入口与接口后记录已上线；发布归档由负责人选择版本。',
        'test_notes','2026/10/26：225 项自动化测试通过，ESLint 和生产构建通过。隔离数据库验证权限、原子历史、并发保护与归档条件。模拟浏览器验证新增、更新、归档、未保存保护和只读权限；桌面及 375px 手机无横向溢出，未发现页面脚本错误。浏览器测试使用本地模拟接口，不冒充生产端到端验收。',
        'deployment_notes',''
      ),'首次登记：功能实现与本地验收完成，数据库已更新；等待推送部署，不提前标记已上线。');
  end if;
end $$;
commit;
