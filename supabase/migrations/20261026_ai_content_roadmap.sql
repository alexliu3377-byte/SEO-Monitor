-- Replace the completed rollout example with the user's actual next idea.
-- Preserve the completed task and all snapshots; never enable a worker or AI API.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $$
declare old_task public.development_tasks; release_uuid uuid;
begin
  if (select count(*) from public.development_tasks where title='开发日志进度与发布归档' and stage='live' and release_id is null)>1 then
    raise exception 'Multiple rollout records; select the intended task before archiving';
  end if;
  select * into old_task from public.development_tasks
    where title='开发日志进度与发布归档' and stage='live' and release_id is null for update;
  if found then
    insert into public.development_releases(version,title,release_date,status,summary,highlights,experimental_features,implementation_notes,limitations,source_note)
    values('v3.2.1','开发进度与发布归档','2026-10-26','completed',
      '开发日志增加独立开发事项，保留需求、检查项、难题、测试与上线记录。已上线事项可归入发布版本，不丢失原来的开发过程。',
      jsonb_build_array('独立记录开发事项、负责人、阶段、检查项与下一步。','每次保存追加完整历史快照，并保护并发编辑。','待上线和已上线分别要求测试与部署依据；已上线事项可手动归档到版本。'),
      '[]'::jsonb,
      jsonb_build_array('沿用超管可读、仅项目负责人可维护的权限。事项、历史与版本列表独立分页。','提交 a21f17b 已核实 Vercel 部署成功；225 项测试、隔离数据库验证、模拟浏览器交互及生产构建通过。'),
      jsonb_build_array('模拟浏览器测试不等同于真人登录账号的线上端到端验收，实际效果仍由负责人复核。','本版本只是开发进度管理，不代表 AI Agent、自动采集联动或 AI 改写已经实现。'),
      '根据负责人与领导的沟通增加开发过程追踪。此处归档的是已上线的 a21f17b，不将后续尚未推送的节点进度条调整混入已发布内容。')
    on conflict(version) do nothing;
    select id into release_uuid from public.development_releases where version='v3.2.1' and title='开发进度与发布归档' and status='completed';
    if release_uuid is null then raise exception 'Release version is occupied by another entry'; end if;
    perform public.save_development_task(old_task.id,old_task.revision,'294f63a9-7c06-455f-9896-0fbc6344cee5',null,
      '按负责人要求，将已上线的开发日志功能收进发布记录，不再作为上方的展示事项；原进度、测试和部署历史全部保留。',release_uuid);
  end if;

  if not exists(select 1 from public.development_tasks where title='AI Agent 自动采集与改写') then
    perform public.save_development_task(null,0,'294f63a9-7c06-455f-9896-0fbc6344cee5',jsonb_build_object(
      'title','AI Agent 自动采集与改写','owner_name','项目负责人','stage','planned',
      'description','计划让系统从百度下拉、相关搜索及现有内容发现线索中发现新词，按规则筛选并归集多来源资料，再根据目标标题生成有差异的软件介绍或相关教程、攻略草稿，交由组员审核、编辑 SEO 标题和确认发布。目前只完成需求方向讨论，尚未实施 Agent 调度及采集、改写联动。',
      'checklist',jsonb_build_array(
        jsonb_build_object('id','6a71873e-6f52-40e4-a878-4938fa96c001','text','梳理新词发现、采集、改写与人工审核方向','done',true),
        jsonb_build_object('id','6a71873e-6f52-40e4-a878-4938fa96c002','text','确认模型接入、运行方式与费用边界','done',false),
        jsonb_build_object('id','6a71873e-6f52-40e4-a878-4938fa96c003','text','定义采集来源、过滤规则与去重标准','done',false),
        jsonb_build_object('id','6a71873e-6f52-40e4-a878-4938fa96c004','text','实现自动采集与多来源资料归集','done',false),
        jsonb_build_object('id','6a71873e-6f52-40e4-a878-4938fa96c005','text','实现目标标题改写与教程攻略草稿','done',false),
        jsonb_build_object('id','6a71873e-6f52-40e4-a878-4938fa96c006','text','真实样本测试与人工审核流程','done',false),
        jsonb_build_object('id','6a71873e-6f52-40e4-a878-4938fa96c007','text','部署定时任务并完成线上验收','done',false)
      ),
      'blocker','模型接入与费用方案尚未确认，尚未开始开发；需先明确过滤规则、素材范围和改写质量要求。',
      'next_step','确认首版来源、过滤规则与输出模板，再确定不新增 AI 费用的可行试跑方式。',
      'test_notes','','deployment_notes',''
    ),'根据已有讨论登记计划：仅需求方向梳理完成，其余均待处理。本次没有启动采集、接入收费 AI 服务或自动发布内容。');
  end if;
end $$;
commit;
