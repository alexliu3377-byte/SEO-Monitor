-- Publish v3.1.1: keyword-library layout collaboration and site-history completion.
begin;

insert into public.development_releases (
  version, title, release_date, status, summary, highlights,
  experimental_features, implementation_notes, limitations,
  deployment_range, source_note
) values (
  'v3.1.1',
  '词库布局协作与站点历史资料补全',
  '2026-10-06',
  'completed',
  '继续完善大词库的分类与多站点布局流程，让组员可以围绕自己负责的站点快速完成关键词布局；同时补全站点权重历史资料，并改善权重与收录的长期查看方式。',
  '["词库布局支持按当前站点、一级分类、二级分类、布局状态和关键词组合筛选", "全部站点视图展示关键词已布局到哪些域名；切换具体站点后只保留与该站点有关的操作信息", "支持单条与批量布局、批量取消、标记问题，已布局站点可以随时取消而不影响其他站点", "开放词库布局给组员使用，并继续按账号限制可见和可操作的站点范围", "权重监控与收录监控的查看弹窗支持上一月、下一月及直接选择月份，每次只读取一个站点一个月", "补充爱站PC与移动历史最高、最低权重及日期；后续收到其他站点资料时可以继续补入", "权重、收录或页面资料出现0时，只有连续两个自然日的有效抓取都为0才写入；请求失败或页面缺字段不会污染历史", "爱站关键词数量不保存，也不会当作百度收录使用"]'::jsonb,
  '[]'::jsonb,
  '["词库布局继续使用现有分组任务站点作为唯一站点来源，避免维护两套名单。", "布局记录按域名保存，同一个关键词可分别布局到多个站点；取消某站点只移除该站点。", "历史监控按月份按需查询，避免一次读取多年资料导致页面截断或超时。", "爱站历史摘要只保存PC和移动权重极值与日期；每日有效抓取发现非0新高或新低时立即更新。", "首次有效0只标记为待确认；次日仍为有效0才更新最低纪录。GitHub Actions与Vercel抓取入口使用同一套判断规则。"]'::jsonb,
  '["目前只补入已经取得可靠爱站历史资料的站点，其他站点将在获得资料后分批补充。", "历史最高最低来自爱站可提供的摘要与系统后续每日有效抓取，不补造缺失日期的每日明细。", "词库分类仍可能存在需要人工修改的个别词，组员可以直接调整后保存。"]'::jsonb,
  '2026-10-05 至 2026-10-06',
  'v3.1.1以词库布局的日常协作为主，同时补齐站点历史权重资料和长期趋势查看。数据口径上严格区分爱站权重、来路数据和百度收录，不把关键词数量混入收录资料。'
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
