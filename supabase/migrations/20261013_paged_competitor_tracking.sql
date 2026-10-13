begin;

-- Daily tracking history stays intact. This partial index supports finding the
-- newest genuinely effective row of each keyword without loading old rows.
create index if not exists competitor_tracking_effective_latest_idx
  on public.competitor_tracking_records (site_id, keyword, discovery_date desc, id)
  where effectiveness = '有效';

create or replace function public.get_competitor_tracking_page(
  p_site_id uuid,
  p_page integer default 0,
  p_page_size integer default 20,
  p_keyword text default '',
  p_content_type text default '',
  p_date_start date default null,
  p_date_end date default null,
  p_sort text default 'discovery_date',
  p_direction text default 'desc'
)
returns jsonb language sql stable security definer set search_path = public
as $$
  with settings as (
    select greatest(0, least(coalesce(p_page, 0), 100000)) as page,
      greatest(1, least(coalesce(p_page_size, 20), 100)) as page_size
  ), latest as materialized (
    select distinct on (r.keyword)
      r.operation_type, r.keyword, r.search_volume, r.content_type,
      r.rank_position, r.rank_volume, r.content_date, r.discovery_date
    from public.competitor_tracking_records r
    where r.site_id = p_site_id and r.effectiveness = '有效'
      and (p_date_start is null or r.discovery_date >= p_date_start)
      and (p_date_end is null or r.discovery_date <= p_date_end)
      -- Keyword is part of the deduplication key, so this filter can be pushed
      -- down safely. A type filter must be applied after deduplication.
      and (coalesce(p_keyword, '') = '' or strpos(lower(r.keyword), lower(p_keyword)) > 0)
    order by r.keyword, r.discovery_date desc, r.id
  ), filtered as materialized (
    select l.*, case when rank_position is null then null else
      round((case when rank_position <= 3 then 10 when rank_position <= 10 then 8
        when rank_position <= 20 then 6 when rank_position <= 30 then 4 else 2 end)
        * (1 + log(10::numeric, (coalesce(rank_volume, 0) + 1)::numeric)) + 1, 1)
      end as score
    from latest l
    where coalesce(p_content_type, '') = '' or l.content_type = p_content_type
  ), ordered as (
    select f.*, row_number() over (order by
      case when p_sort = 'search_volume' and p_direction = 'asc' then search_volume end asc nulls last,
      case when p_sort = 'search_volume' and p_direction <> 'asc' then search_volume end desc nulls last,
      case when p_sort = 'rank_position' and p_direction = 'asc' then rank_position end asc nulls last,
      case when p_sort = 'rank_position' and p_direction <> 'asc' then rank_position end desc nulls last,
      case when p_sort = 'rank_volume' and p_direction = 'asc' then rank_volume end asc nulls last,
      case when p_sort = 'rank_volume' and p_direction <> 'asc' then rank_volume end desc nulls last,
      case when p_sort = 'score' and p_direction = 'asc' then score end asc nulls last,
      case when p_sort = 'score' and p_direction <> 'asc' then score end desc nulls last,
      case when p_sort = 'content_date' and p_direction = 'asc' then content_date end asc nulls last,
      case when p_sort = 'content_date' and p_direction <> 'asc' then content_date end desc nulls last,
      case when p_sort = 'discovery_date' and p_direction = 'asc' then discovery_date end asc nulls last,
      case when p_sort = 'discovery_date' and p_direction <> 'asc' then discovery_date end desc nulls last,
      discovery_date desc, keyword
    ) as row_order from filtered f
  ), page_rows as (
    select * from ordered order by row_order
    limit (select page_size from settings)
    offset (select page::bigint * page_size from settings)
  )
  select jsonb_build_object(
    'rows', coalesce((select jsonb_agg(to_jsonb(p) - 'row_order' order by p.row_order) from page_rows p), '[]'::jsonb),
    'total', (select count(*) from filtered),
    'page', (select page from settings), 'pageSize', (select page_size from settings)
  )
$$;

revoke all on function public.get_competitor_tracking_page(uuid, integer, integer, text, text, date, date, text, text) from public, anon, authenticated;
grant execute on function public.get_competitor_tracking_page(uuid, integer, integer, text, text, date, date, text, text) to service_role;
commit;
