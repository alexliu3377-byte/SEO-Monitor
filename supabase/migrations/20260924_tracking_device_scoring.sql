-- Keep the latest independent M/PC and rankup/rankdown evidence for each URL
-- and keyword. Missing from today's first 15 pages must not erase the last
-- confirmed observation. On the same day both directions remain available;
-- application scoring gives rankup priority while showing the conflict.
begin;

create index if not exists idx_site_keyword_ranks_url_platform_type_date
  on public.site_keyword_ranks (
    url, keyword, platform, type, stat_date desc, rank_position asc, id asc
  )
  where url is not null;

create or replace function public.get_latest_site_keyword_ranks_by_urls(
  p_urls text[]
)
returns setof public.site_keyword_ranks
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select distinct on (
    rank_row.url,
    rank_row.keyword,
    rank_row.platform,
    rank_row.type
  ) rank_row.*
  from public.site_keyword_ranks rank_row
  where rank_row.url is not null
    and rank_row.url = any(p_urls)
  order by
    rank_row.url,
    rank_row.keyword,
    rank_row.platform,
    rank_row.type,
    rank_row.stat_date desc,
    rank_row.rank_position asc nulls last,
    rank_row.id asc
$$;

revoke all on function public.get_latest_site_keyword_ranks_by_urls(text[]) from public, anon, authenticated;
grant execute on function public.get_latest_site_keyword_ranks_by_urls(text[]) to service_role;

commit;
