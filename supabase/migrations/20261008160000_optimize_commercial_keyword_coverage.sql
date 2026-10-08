-- Commercial keyword coverage used to scan and sort seven days of
-- site_keyword_ranks in the API. Keep that lookup index-backed and let
-- Postgres return only the latest row for each site/keyword/platform tuple.
create index if not exists idx_site_keyword_ranks_keyword_date_coverage
  on public.site_keyword_ranks (keyword, stat_date desc)
  include (site_id, platform, id, rank_position, title, url);

create or replace function public.get_latest_commercial_keyword_coverage(
  p_keywords text[],
  p_since date
)
returns setof public.site_keyword_ranks
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select distinct on (
    rank_row.site_id,
    rank_row.keyword,
    rank_row.platform
  ) rank_row.*
  from public.site_keyword_ranks rank_row
  where rank_row.keyword = any(p_keywords)
    and rank_row.stat_date >= p_since
  order by
    rank_row.site_id,
    rank_row.keyword,
    rank_row.platform,
    rank_row.stat_date desc,
    rank_row.id asc
$$;

revoke all on function public.get_latest_commercial_keyword_coverage(text[], date)
  from public, anon, authenticated;
grant execute on function public.get_latest_commercial_keyword_coverage(text[], date)
  to service_role;
