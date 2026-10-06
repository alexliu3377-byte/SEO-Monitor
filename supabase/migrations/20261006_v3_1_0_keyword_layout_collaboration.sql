-- Publish the keyword-library classification and multi-site layout workflow.
begin;

insert into public.development_releases (
  version, title, release_date, status, summary, highlights,
  experimental_features, implementation_notes, limitations,
  deployment_range, source_note
) values (
  'v3.1.0',
  '词库分类与多站点布局协作',
  '2026-10-06',
  'completed',
  '把体量较大的搜索词资料整理成可筛选、可修正、可分站协作的词库布局工作台。组员可以按自己负责的站点快速判断哪些词尚未布局，并通过单条或批量操作完成布局、取消和问题标记。',
  '["建立游戏、应用、专题、资讯和排行榜等一级分类，并补充游戏与应用的细分类别", "新增 AI工具与浏览器等应用分类，并收紧排行榜关键词判断规则", "词库布局支持按当前站点、一级分类、二级分类、布局状态和关键词联合筛选", "不同站点使用稳定颜色区分；全部站点视图可查看一个词已布局到哪些站点", "布局操作支持随时取消，不影响同一关键词在其他站点的布局", "列表支持当前页勾选与全选，并可批量布局、批量取消或标记问题", "普通组员只处理自己可访问的分组站点，管理员与超管按既有权限查看站点", "有问题的词可单独筛选；仅超管可以永久删除并加入排除名单，防止再次入库"]'::jsonb,
  '[]'::jsonb,
  '["布局站点直接使用现有分组任务中的域名，避免维护第二套站点名单。", "接口按登录账号重新校验可访问站点；批量操作单次最多处理 100 个关键词，当前页面每页 50 个。", "站点布局以域名数组保存；取消某个站点时保留其他站点记录，普通组员也不会覆盖自己无权访问的站点。", "问题标记与布局记录分开保存；取消问题后会根据仍有无布局站点自动恢复为已布局或未布局。", "永久删除会同时写入词库排除名单，后续抓取不会把同一个问题词重新加入。"]'::jsonb,
  '["现有大批量词库仍可能包含需要人工修正的分类，组员可直接修改分类后保存。", "批量勾选只作用于当前页，切换筛选条件或翻页后需要重新选择。", "永久删除仍限制为超管操作，避免组员误删共享词库资料。"]'::jsonb,
  '2026-10-02 至 2026-10-06',
  '这一版本把原本难以使用的大词库变成面向日常工作的站点布局清单。重点不是继续展示更多系统判断资料，而是让每位组员只看与自己站点有关的状态，并能快速完成可撤销的批量操作。'
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
