-- Expand the existing JSON cache inside PostgreSQL, then filter and paginate.
-- This keeps the complete cache off the API/network while preserving its rows.
begin;

create or replace function public.get_wordlib_cache_page(
  p_group_id uuid default null,
  p_expected_filter_hash text default null,
  p_page integer default 0,
  p_page_size integer default 20,
  p_keyword text default '',
  p_date date default null,
  p_start_date date default null,
  p_end_date date default null,
  p_min_long_tail integer default 2,
  p_min_sites integer default 1,
  p_site text default '',
  p_sort text default 'date',
  p_direction text default 'desc',
  p_today date default ((now() at time zone 'Asia/Kuala_Lumpur')::date)
) returns jsonb language sql stable security definer
set search_path = public, pg_temp
set statement_timeout = '15s'
as $function$
with options as (
  select greatest(0, least(coalesce(p_page, 0), 1000000)) as page,
    greatest(1, least(coalesce(p_page_size, 20), 100)) as page_size,
    greatest(2, coalesce(p_min_long_tail, 2)) as min_long_tail,
    greatest(1, coalesce(p_min_sites, 1)) as min_sites,
    lower(coalesce(p_keyword, '')) as keyword,
    lower(coalesce(p_site, '')) as site,
    case when p_sort in ('date', 'longTailCount', 'siteCount', 'keyword') then p_sort else 'date' end as sort,
    case when p_direction = 'asc' then 'asc' else 'desc' end as direction
), cache_source as materialized (
  select c.payload, c.computed_at, null::text as filter_hash
  from public.wordlib_cache c where p_group_id is null and c.id = 'latest'
  union all
  select c.wordlib_payload, c.computed_at, c.filter_hash
  from public.group_hot_radar_cache c where p_group_id is not null and c.group_id = p_group_id
), valid_cache as materialized (
  select * from cache_source
  where jsonb_typeof(payload) = 'array'
    and (p_group_id is null or (p_expected_filter_hash is not null and filter_hash = p_expected_filter_hash))
), entries as materialized (
  select row.keyword, row.long_tail_count, row.site_count, coalesce(row.sites, '{}') as sites, row.last_date,
    -- Match the existing UI date convention without changing the stored or
    -- returned last_date: today's overnight batch is displayed as yesterday.
    case when left(row.last_date, 10) = p_today::text then (p_today - 1)::text
      else left(row.last_date, 10) end as display_date
  from valid_cache c
  cross join lateral jsonb_to_recordset(c.payload)
    as row(keyword text, long_tail_count integer, site_count integer, sites text[], last_date text)
), filtered as materialized (
  select e.* from entries e cross join options o
  where e.long_tail_count >= o.min_long_tail and e.site_count >= o.min_sites
    -- Substring searches are literal: %, _ and backslashes are not wildcards.
    and (o.keyword = '' or strpos(lower(e.keyword), o.keyword) > 0)
    and (o.site = '' or exists (select 1 from unnest(e.sites) domain where strpos(lower(domain), o.site) > 0))
    and (p_date is null or e.display_date = p_date::text)
    and (p_start_date is null or e.display_date >= p_start_date::text)
    and (p_end_date is null or e.display_date <= p_end_date::text)
), ordered as (
  select f.*, row_number() over (order by
    case when o.sort = 'date' and o.direction = 'asc' then f.display_date end asc nulls last,
    case when o.sort = 'date' and o.direction = 'desc' then f.display_date end desc nulls last,
    case when o.sort = 'longTailCount' and o.direction = 'asc' then f.long_tail_count end asc nulls last,
    case when o.sort = 'longTailCount' and o.direction = 'desc' then f.long_tail_count end desc nulls last,
    case when o.sort = 'siteCount' and o.direction = 'asc' then f.site_count end asc nulls last,
    case when o.sort = 'siteCount' and o.direction = 'desc' then f.site_count end desc nulls last,
    case when o.sort = 'keyword' and o.direction = 'asc' then f.keyword end asc nulls last,
    case when o.sort = 'keyword' and o.direction = 'desc' then f.keyword end desc nulls last,
    f.long_tail_count desc, f.site_count desc, f.keyword asc
  ) as row_number
  from filtered f cross join options o
), paged as (
  select r.* from ordered r cross join options o
  where r.row_number > o.page::bigint * o.page_size
    and r.row_number <= (o.page::bigint + 1) * o.page_size
)
select jsonb_build_object(
  'cacheReady', exists(select 1 from valid_cache),
  'data', coalesce((select jsonb_agg(jsonb_build_object(
    'keyword', keyword, 'long_tail_count', long_tail_count, 'site_count', site_count,
    'sites', sites, 'last_date', last_date
  ) order by row_number) from paged), '[]'::jsonb),
  'total', (select count(*) from filtered),
  'page', o.page,
  'pageSize', o.page_size,
  'computedAt', (select computed_at from valid_cache limit 1),
  'availableDates', coalesce((select jsonb_agg(display_date order by display_date desc)
    from (select distinct display_date from entries where coalesce(display_date, '') <> '') dates), '[]'::jsonb),
  'availableSites', coalesce((select jsonb_agg(domain order by domain)
    from (select distinct unnest(sites) as domain from entries) domains where coalesce(domain, '') <> ''), '[]'::jsonb)
)
from options o;
$function$;

revoke all on function public.get_wordlib_cache_page(uuid,text,integer,integer,text,date,date,date,integer,integer,text,text,text,date)
  from public, anon, authenticated;
grant execute on function public.get_wordlib_cache_page(uuid,text,integer,integer,text,date,date,date,integer,integer,text,text,text,date)
  to service_role;

commit;
