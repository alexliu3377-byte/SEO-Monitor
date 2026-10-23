-- Ranking tabs always keep date, then new/update badge ahead of metric sorts.
-- Order the full filtered result before pagination; reuse existing cached data.
begin;
set local lock_timeout='5s';
create or replace function public.get_daily_radar_page(
  p_date date,p_scope text,p_tab text,p_group_id uuid default null,p_page integer default 0,p_size integer default 20,
  p_keyword text default '',p_site text default '',p_min_sites integer default 1,p_min_streak integer default 2,
  p_badge text default 'all',p_sort text default 'date',p_direction text default 'desc'
) returns jsonb language sql stable security definer set search_path=public,pg_temp
set statement_timeout='20s' set jit='off' set work_mem='16MB' as $$
with source as materialized (
  select * from radar_daily_cache where (p_date is null or data_date=p_date) and scope_key=p_scope
    and data_date between (now() at time zone 'Asia/Kuala_Lumpur')::date-6 and (now() at time zone 'Asia/Kuala_Lumpur')::date
    and (p_date is not null or p_tab not in ('cross','newWords','wordLib')
      or data_date < (now() at time zone 'Asia/Kuala_Lumpur')::date)
), options as (
  select greatest(0,p_page) as page,greatest(1,least(500,p_size)) as size,
    case p_tab when 'rank' then 'rankWords' when 'streak' then 'streakWords'
      when 'volumeRising' then 'volumeRisingWords' else p_tab end as section
), rows as materialized (
  select e.value as item,s.data_date as signal_date from source s cross join options o
    cross join lateral jsonb_array_elements(coalesce(s.payload->o.section,'[]'::jsonb)) e
), completed_claims as materialized (
  select keyword,final_keyword,
    coalesce((submitted_at at time zone 'Asia/Kuala_Lumpur')::date,claimed_date) as completed_date
  from member_claimed_keywords
  where p_group_id is not null and p_tab<>'wordLib'
    and group_id=p_group_id and status='submitted'
    and (submitted_at >= (coalesce(p_date,(now() at time zone 'Asia/Kuala_Lumpur')::date-6)::timestamp at time zone 'Asia/Kuala_Lumpur')
      or (submitted_at is null and claimed_date>=coalesce(p_date,(now() at time zone 'Asia/Kuala_Lumpur')::date-6)))
), completed_keywords as materialized (
  select k.keyword,max(c.completed_date) as completed_date from completed_claims c
  cross join lateral (values(c.keyword),(c.final_keyword)) k(keyword)
  where k.keyword is not null group by k.keyword
), filtered as materialized (
  select item,signal_date,case when item->>'first_date'=signal_date::text or (p_tab='streak' and (item->>'streak')::int=2) then 'new' else 'updated' end as badge
  from rows left join completed_keywords c on c.keyword=item->>'keyword'
  where (p_keyword='' or strpos(lower(item->>'keyword'),lower(p_keyword))>0)
    and (p_site='' or strpos(lower(coalesce(item->>'domain','')),lower(p_site))>0
      or exists(select 1 from jsonb_array_elements_text(coalesce(item->'sites','[]'::jsonb)) d where strpos(lower(d),lower(p_site))>0))
    and coalesce((item->>'siteCount')::int,(item->>'site_count')::int,1)>=p_min_sites
    and (p_tab<>'streak' or (item->>'streak')::int>=p_min_streak)
    and (c.completed_date is null or c.completed_date<signal_date)
), eligible as materialized (
  select * from filtered where p_badge='all' or badge=p_badge
), ranked as (
  select item,row_number() over(order by
    -- Numeric/keyword sorts are tertiary within each ranking day and badge.
    -- Explicit date ascending still reverses days, never badge priority.
    case when p_tab in ('rank','streak') and p_sort='date' and p_direction='asc' then item->>'last_date' end asc nulls last,
    case when p_tab in ('rank','streak') and (p_sort<>'date' or p_direction<>'asc') then item->>'last_date' end desc nulls last,
    case when p_tab in ('rank','streak') then case badge when 'new' then 0 else 1 end end asc,
    case when p_direction='asc' then case p_sort when 'keyword' then item->>'keyword' when 'date' then item->>'last_date' end end asc nulls last,
    case when p_direction<>'asc' then case p_sort when 'keyword' then item->>'keyword' when 'date' then item->>'last_date' end end desc nulls last,
    case when p_tab='newWords' and p_sort='date' then case badge when 'new' then 0 else 1 end end asc,
    case when p_direction='asc' and p_sort in ('volume','count','siteCount','rankDays','streak','change','netChange','long_tail_count','site_count') then coalesce(nullif(item->>p_sort,'')::numeric,0) end asc nulls last,
    case when p_direction<>'asc' and p_sort in ('volume','count','siteCount','rankDays','streak','change','netChange','long_tail_count','site_count') then coalesce(nullif(item->>p_sort,'')::numeric,0) end desc nulls last,
    coalesce((item->>'volume')::numeric,(item->>'count')::numeric,(item->>'long_tail_count')::numeric,0) desc,
    item->>'keyword',item->>'domain',signal_date desc) as position
  from eligible
)
select jsonb_build_object('cacheReady',exists(select 1 from source),
 'date',coalesce(p_date::text,'all'),
 'cachedDates',coalesce((select jsonb_agg(data_date order by data_date desc) from source),'[]'::jsonb),
 'computedAt',(select min(computed_at) from source),'total',(select count(*) from eligible),
 'data',coalesce((select jsonb_agg(item order by position) from ranked cross join options
    where position>page::bigint*size and position<=(page::bigint+1)*size),'[]'::jsonb))
$$;
commit;
