begin;

-- Add the requested Xiaohongshu entry to existing installations without
-- replacing the owner's current query list.
insert into public.trend_collection_queries (platform, query, normalized_query, sort_order, enabled)
select 'xiaohongshu', '游戏资源分享', '游戏资源分享',
  coalesce((select max(sort_order) + 1 from public.trend_collection_queries where platform = 'xiaohongshu'), 1),
  true
where not exists (
  select 1 from public.trend_collection_queries
  where platform = 'xiaohongshu' and normalized_query = '游戏资源分享'
);

commit;
