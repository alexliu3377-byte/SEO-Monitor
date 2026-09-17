-- Keep retry/tracking bounded as the historical ranking and tracking tables
-- continue to grow. Run this before deploying the matching application code.
begin;

create index if not exists idx_site_keyword_ranks_url_date_position
  on public.site_keyword_ranks (url, stat_date desc, rank_position asc, id asc)
  where url is not null;

create index if not exists idx_site_tracking_records_group_claim_latest
  on public.site_tracking_records (
    group_id, claim_id, record_date desc, submit_date desc, id asc
  );

create or replace function public.get_latest_site_keyword_ranks_by_urls(
  p_urls text[]
)
returns setof public.site_keyword_ranks
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select distinct on (rank_row.url, rank_row.keyword) rank_row.*
  from public.site_keyword_ranks rank_row
  where rank_row.url is not null
    and rank_row.url = any(p_urls)
  order by
    rank_row.url,
    rank_row.keyword,
    rank_row.stat_date desc,
    rank_row.rank_position asc nulls last,
    rank_row.id asc
$$;

create or replace function public.get_latest_group_tracking_records(
  p_group_id uuid,
  p_offset integer default 0,
  p_limit integer default 1000
)
returns setof public.site_tracking_records
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select latest.*
  from (
    select distinct on (track_row.claim_id) track_row.*
    from public.site_tracking_records track_row
    where track_row.group_id = p_group_id
    order by
      track_row.claim_id,
      track_row.record_date desc,
      track_row.submit_date desc,
      track_row.id asc
  ) latest
  order by
    latest.record_date desc,
    latest.submit_date desc,
    latest.id asc
  offset greatest(coalesce(p_offset, 0), 0)
  limit least(greatest(coalesce(p_limit, 1000), 1), 1000)
$$;

revoke all on function public.get_latest_site_keyword_ranks_by_urls(text[]) from public;
revoke all on function public.get_latest_group_tracking_records(uuid, integer, integer) from public;
grant execute on function public.get_latest_site_keyword_ranks_by_urls(text[]) to service_role;
grant execute on function public.get_latest_group_tracking_records(uuid, integer, integer) to service_role;

commit;
