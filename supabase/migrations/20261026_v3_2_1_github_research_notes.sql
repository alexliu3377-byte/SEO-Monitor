-- Append the owner's verified GitHub research and trial results to v3.2.1.
-- Preserve version/date/title/status and older entries; never enable an Agent,
-- change a development task's progress, or start a collector from release notes.
begin;
set local lock_timeout='5s';
set local statement_timeout='15s';

do $$
declare
  notes jsonb := $release_notes$
  {
    "version": "v3.2.1",
    "expected_title": "开发进度与发布归档",
    "summary_append": "补充记录 GitHub 开源方案调研与小范围验证：以奇心现有资料、权限和业务规则为核心，分别说明已落地工具、实验结果及尚未实现的能力。",
    "highlights": [
      "完成 GitHub 开源方案调研：参考 Craft 的资料与权限分离思路，评估 LangGraph JS／Mastra 工作流、Crawlee 采集及 Promptfoo 质量检查；不恢复已删除的页面设计系统。",
      "增加 GitHub 云端只读采集检查，区分流程结束与资料完整，核对五类 SEO 步骤及 B 站当天采集记录；失败使用 GitHub 原生邮件通知，负责人已确认能收到邮件。"
    ],
    "experimental_features": [
      "LangGraph JS 与 Mastra 已用相同的既有异常资料做隔离流程试验，验证同进程暂停／恢复、失败步骤重试及重复恢复保护；尚未验证进程重启或电脑断电后的持久化恢复。",
      "Crawlee 已在 GitHub 托管 Runner 对牛酷网、超好玩各一页完成首轮只读对照；计划 10/27–29 每日 08:17 MYT 继续试跑，GitHub 排队可能延迟，不替换原采集、不写入生产资料。",
      "已有负责人手动触发的本地内容 Agent 原型，可受控读取选中的奇心资料并进入人工审核；不等于已完成团队任务领取、全天调度或自动采集改写发布。"
    ],
    "implementation_notes": [
      "架构取舍：奇心现有 Supabase 资料、分组权限和业务规则继续作为核心，不直接搬入第三方应用，也不同时引入两套 Agent 工作流运行时。",
      "Crawlee 依赖放在独立工具目录，没有加入网站正式依赖；只读试跑限制并发及重试，403／429 停止。分类过滤和日期识别是自定义规则，不是框架自动修好业务资料。",
      "验证依据：本地原型 c31d177、调研与验证记录 235c115、只读试跑与健康检查 e60ef8b；GitHub 执行 40298698900 中 Crawlee 两站成功，健康检查因既有来源资料不完整返回失败。"
    ],
    "limitations": [
      "未接通正式 AI Agent 调度、百度实时下拉联动、自动补采、自动改写发布或断电后自动恢复；LangGraph／Mastra 暂为候选，不把隔离测试记为这些能力已上线。",
      "Promptfoo 按负责人要求暂缓。本轮没有新增收费模型 API 或邮件服务；GitHub Actions 分钟和报告存储仍受平台额度约束，开源不等于所有运行成本都免费。",
      "邮件检查只能发现逾期或资料异常，不能断定电脑断电；不是实时心跳，也不验证转写准确率。首轮试跑通过不代表旧采集资料已修正，历史问题仍需分别处理。"
    ],
    "source_note_append": "2026-10-26 按负责人要求补充 GitHub 开源调研与验证过程，依据仓库文档、隔离测试、已推送提交及 GitHub 实际执行结果整理。研究完成、有限试验和正式上线明确分开，不调整既有开发事项完成度。"
  }
  $release_notes$::jsonb;
  release_row public.development_releases;
  merged jsonb;
  field_name text;
  additions jsonb;
begin
  select * into strict release_row from public.development_releases
    where version=notes->>'version' for update;
  if release_row.title<>notes->>'expected_title' or release_row.status<>'completed' then
    raise exception 'Unexpected v3.2.1 release; review before updating';
  end if;
  merged=to_jsonb(release_row);
  foreach field_name in array array['highlights','experimental_features','implementation_notes','limitations'] loop
    select coalesce(jsonb_agg(value order by ordinal),'[]'::jsonb) into additions
      from jsonb_array_elements(notes->field_name) with ordinality as entry(value,ordinal)
      where not (merged->field_name @> jsonb_build_array(value));
    merged=jsonb_set(merged,array[field_name],(merged->field_name)||additions);
  end loop;
  if strpos(release_row.summary,notes->>'summary_append')=0 then
    merged=jsonb_set(merged,'{summary}',to_jsonb(release_row.summary||' '||(notes->>'summary_append')));
  end if;
  if strpos(coalesce(release_row.source_note,''),notes->>'source_note_append')=0 then
    merged=jsonb_set(merged,'{source_note}',to_jsonb(concat_ws(E'\n',nullif(release_row.source_note,''),notes->>'source_note_append')));
  end if;
  if merged=to_jsonb(release_row) then return; end if;
  update public.development_releases set
    summary=merged->>'summary', highlights=merged->'highlights',
    experimental_features=merged->'experimental_features',
    implementation_notes=merged->'implementation_notes', limitations=merged->'limitations',
    source_note=merged->>'source_note'
    where id=release_row.id;
end $$;

commit;
