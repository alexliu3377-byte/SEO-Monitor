begin;

-- Durable observations are not seven-day cache data. Old unknown dates are
-- intentionally not backfilled: the previous single row cannot prove them.
create table if not exists public.keyword_volume_observations (
  id bigint generated always as identity primary key,
  keyword text not null,
  observed_at timestamptz not null default now(),
  observed_date date not null default ((now() at time zone 'Asia/Kuala_Lumpur')::date),
  stat_date date,
  volume bigint not null,
  previous_volume bigint,
  baseline_volume bigint,
  baseline_date date
);
create index if not exists keyword_volume_observations_day_keyword_idx
  on public.keyword_volume_observations(observed_date,keyword,observed_at desc,id desc);
alter table public.keyword_volume_observations enable row level security;
revoke all on public.keyword_volume_observations from public,anon,authenticated;
grant all on public.keyword_volume_observations to service_role;
grant usage,select on sequence public.keyword_volume_observations_id_seq to service_role;
create or replace function public.record_keyword_volume_observation() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  if tg_op='INSERT' then
    insert into keyword_volume_observations(keyword,stat_date,volume,previous_volume,baseline_volume,baseline_date)
      values(new.keyword,new.stat_date,new.volume,null,new.baseline_volume,new.baseline_date);
  elsif new.volume is distinct from old.volume and (old.stat_date is null or new.stat_date>=old.stat_date) then
    insert into keyword_volume_observations(keyword,stat_date,volume,previous_volume,baseline_volume,baseline_date)
      values(new.keyword,new.stat_date,new.volume,old.volume,new.baseline_volume,new.baseline_date);
  end if;
  return new;
end;
$$;
revoke all on function public.record_keyword_volume_observation() from public,anon,authenticated;
drop trigger if exists keyword_volume_observation on public.keyword_volume;
create trigger keyword_volume_observation after insert or update on public.keyword_volume
  for each row execute function public.record_keyword_volume_observation();

create table if not exists public.radar_daily_cache (
  data_date date not null,
  scope_key text not null,
  rank_domains text[] not null default '{}',
  new_domains text[] not null default '{}',
  payload jsonb not null,
  computed_at timestamptz not null default now(),
  primary key(data_date,scope_key)
);
alter table public.radar_daily_cache enable row level security;
revoke all on public.radar_daily_cache from public,anon,authenticated;
grant all on public.radar_daily_cache to service_role;

-- Per-day, per-filter atomic publication. There is NO top-2000 truncation here.
-- Historical calculations exclude all observations and content after p_date.
create or replace function public.refresh_daily_radar_cache(
  p_date date,p_scope text,p_rank_domains text[] default '{}',p_new_domains text[] default '{}'
) returns jsonb language plpgsql security definer set search_path=public,pg_temp
set statement_timeout='120s' set jit='off' set work_mem='16MB' set enable_nestloop='off' as $$
declare result jsonb;
begin
  if p_date < (now() at time zone 'Asia/Kuala_Lumpur')::date-6
    or p_date > (now() at time zone 'Asia/Kuala_Lumpur')::date or coalesce(p_scope,'')='' then
    raise exception 'Invalid daily radar date/scope';
  end if;
  if not pg_try_advisory_xact_lock(hashtextextended('radar:'||p_scope||':'||p_date::text,0)) then
    raise exception 'Daily radar is already rebuilding';
  end if;
  with new_sites as materialized (
    select id,domain from sites where coalesce(cardinality(p_new_domains),0)=0
      or lower(regexp_replace(domain,'^www\.','','i'))=any(p_new_domains)
  ), raw_history as materialized (
    select r.keyword,r.site_id,s.domain,r.content_date
    from raw_keywords r join new_sites s on s.id=r.site_id
    where r.content_date between p_date-30 and p_date
  ), new_daily as (
    select keyword,count(*) as count,count(distinct site_id) as site_count,
      array_agg(distinct domain order by domain) as sites
    from raw_history where content_date=p_date group by keyword
    having count(distinct site_id)>=case when coalesce(cardinality(p_new_domains),0)=0 then 2 else 1 end
  ), first_dates as (
    select keyword,min(content_date) as first_date from raw_history group by keyword
  ), new_words as materialized (
    select n.*,f.first_date from new_daily n join first_dates f using(keyword)
  ), rank_sites as materialized (
    select id,domain from sites where coalesce(cardinality(p_rank_domains),0)=0
      or lower(regexp_replace(domain,'^www\.','','i'))=any(p_rank_domains)
  ), daily_ranks as materialized (
    select keyword,site_id,max(volume) as volume from (
      select r.keyword,r.site_id,r.volume from rank_changes r join rank_sites s on s.id=r.site_id
      where r.stat_date=p_date and r.type='rankup'
      union all
      select r.keyword,r.site_id,r.volume from site_keyword_ranks r join rank_sites s on s.id=r.site_id
      where r.stat_date=p_date and r.type='rankup'
    ) r group by keyword,site_id
  ), rank_context as materialized (
    select r.*,s.domain, array(select distinct d from unnest(coalesce(k.recent_dates,'{}'::date[])||array[p_date]) d
      where d between p_date-30 and p_date order by d) as dates
    from daily_ranks r join rank_sites s on s.id=r.site_id
    left join keyword_signal_rollup k on k.site_id=r.site_id and k.keyword=r.keyword and k.type='rankup'
  ), rank_words as materialized (
    select keyword,count(distinct site_id) as site_count,max(volume) as volume,
      array_agg(distinct domain order by domain) as sites,min(dates[1]) as first_date,
      max(cardinality(dates)) as rank_days from rank_context group by keyword
  ), streak_candidates as (
    select r.*, (select count(*) from (
      select d,row_number() over(order by d desc) as position from unnest(r.dates) d
    ) consecutive where p_date-d=position-1) as streak
    from rank_context r
  ), streak_words as (
    select * from streak_candidates where streak>=2 and keyword in (
      select keyword from streak_candidates where streak>=2 group by keyword having count(distinct domain)=1
    )
  ), unique_kws as materialized (select distinct keyword from raw_history),
  actual_bases as (
    select k.keyword,min(length(b.keyword)) as base_length
    from unique_kws k cross join lateral generate_series(1,length(k.keyword)-1) span(n)
    join unique_kws b on b.keyword=left(k.keyword,n) group by k.keyword
  ), keyword_base as (
    select k.keyword,coalesce(left(k.keyword,b.base_length),k.keyword) as base
    from unique_kws k left join actual_bases b on b.keyword=k.keyword
  ), wordlib as (
    select b.base as keyword,count(distinct b.keyword) as long_tail_count,
      count(distinct h.domain) as site_count,array_agg(distinct h.domain order by h.domain) as sites
    from keyword_base b join raw_history h on h.keyword=b.keyword
    group by b.base having count(distinct b.keyword)>=2 and bool_or(h.content_date=p_date)
  ), volume_events as (
    select distinct on(keyword) keyword,volume,previous_volume,volume-previous_volume as change,
      baseline_volume,baseline_date,volume-baseline_volume as net_change,stat_date,true as historical_values_known
    from keyword_volume_observations where observed_date=p_date and previous_volume is not null
      and volume>previous_volume order by keyword,observed_at desc,id desc
  ), volume_words as (
    select * from volume_events
    union all
    -- A legacy known DATE remains useful, but its historical numerical values
    -- were not kept. Show current values explicitly; do not invent a delta.
    select v.keyword,v.volume,null::bigint,null::bigint,v.baseline_volume,v.baseline_date,
      v.net_volume_change,v.stat_date,false
    from keyword_volume v where v.last_volume_increase_date=p_date and v.net_volume_change>0
      and not exists(select 1 from volume_events e where e.keyword=v.keyword)
  ), volume_ranks as (
    select r.keyword,array_agg(distinct s.domain order by s.domain) as sites,
      case when bool_or(r.type='rankup') and bool_or(r.type='rankdown') then 'both'
        when bool_or(r.type='rankup') then 'up' else 'down' end as trend
    from (
      select keyword,site_id,type from rank_changes where stat_date=p_date and type in ('rankup','rankdown')
      union all
      select keyword,site_id,type from site_keyword_ranks where stat_date=p_date and type in ('rankup','rankdown')
    ) r join volume_words v on v.keyword=r.keyword join sites s on s.id=r.site_id
    group by r.keyword
  )
  select jsonb_build_object(
    'newWords',coalesce((select jsonb_agg(jsonb_build_object('keyword',keyword,'count',count,'siteCount',site_count,
      'sites',sites,'first_date',first_date,'last_date',p_date) order by count desc,keyword) from new_words),'[]'::jsonb),
    'rankWords',coalesce((select jsonb_agg(jsonb_build_object('keyword',keyword,'siteCount',site_count,'volume',volume,
      'sites',sites,'first_date',first_date,'last_date',p_date,'rankDays',rank_days) order by volume desc,keyword) from rank_words),'[]'::jsonb),
    'streakWords',coalesce((select jsonb_agg(jsonb_build_object('keyword',keyword,'domain',domain,'streak',streak,'volume',volume,
      'first_date',p_date-(streak::int-1),'last_date',p_date) order by streak desc,volume desc,keyword,domain) from streak_words),'[]'::jsonb),
    'cross',coalesce((select jsonb_agg(jsonb_build_object('keyword',n.keyword,'volume',r.volume,'first_date',least(n.first_date,r.first_date),
      'last_date',p_date,'newSites',n.sites,'rankSites',r.sites,'sites',array(select distinct unnest(n.sites||r.sites)),
      'dims',array['new','rank'],'siteCount',least(n.site_count,r.site_count))) from new_words n join rank_words r using(keyword)),'[]'::jsonb),
    'wordLib',coalesce((select jsonb_agg(jsonb_build_object('keyword',keyword,'long_tail_count',long_tail_count,'site_count',site_count,
      'sites',sites,'last_date',p_date) order by long_tail_count desc,keyword) from wordlib),'[]'::jsonb),
    'volumeRisingWords',coalesce((select jsonb_agg(jsonb_build_object('keyword',v.keyword,'volume',volume,'prevVolume',previous_volume,'change',change,
      'baselineVolume',baseline_volume,'baselineDate',baseline_date,'netChange',net_change,'last_date',p_date,'riseDate',p_date,
      'volumeDate',stat_date,'sites',coalesce(r.sites,'{}'::text[]),'rankTrend',r.trend,'historicalValuesKnown',historical_values_known)
      order by net_change desc nulls last,v.keyword) from volume_words v left join volume_ranks r using(keyword)),'[]'::jsonb)
  ) into result;
  insert into radar_daily_cache(data_date,scope_key,rank_domains,new_domains,payload,computed_at)
    values(p_date,p_scope,p_rank_domains,p_new_domains,result,now())
    on conflict(data_date,scope_key) do update set payload=excluded.payload,computed_at=excluded.computed_at,
      rank_domains=excluded.rank_domains,new_domains=excluded.new_domains;
  return jsonb_build_object('counts',(select jsonb_object_agg(key,jsonb_array_length(value)) from jsonb_each(result)));
end;
$$;

create or replace function public.prune_daily_radar_cache() returns integer
language plpgsql security definer set search_path=public as $$
declare removed integer;
begin
  delete from radar_daily_cache where data_date<(now() at time zone 'Asia/Kuala_Lumpur')::date-6;
  get diagnostics removed=row_count;
  return removed;
end;
$$;

create or replace function public.get_daily_radar_page(
  p_date date,p_scope text,p_tab text,p_group_id uuid default null,p_page integer default 0,p_size integer default 20,
  p_keyword text default '',p_site text default '',p_min_sites integer default 1,p_min_streak integer default 2,
  p_badge text default 'all',p_sort text default 'date',p_direction text default 'desc'
) returns jsonb language sql stable security definer set search_path=public,pg_temp
set statement_timeout='20s' set jit='off' set work_mem='16MB' as $$
with source as materialized (
  select * from radar_daily_cache where (p_date is null or data_date=p_date) and scope_key=p_scope
    and data_date between (now() at time zone 'Asia/Kuala_Lumpur')::date-6 and (now() at time zone 'Asia/Kuala_Lumpur')::date
), options as (
  select greatest(0,p_page) as page,greatest(1,least(500,p_size)) as size,
    case p_tab when 'rank' then 'rankWords' when 'streak' then 'streakWords'
      when 'volumeRising' then 'volumeRisingWords' else p_tab end as section
), rows as materialized (
  select e.value as item,s.data_date as signal_date from source s cross join options o
    cross join lateral jsonb_array_elements(coalesce(s.payload->o.section,'[]'::jsonb)) e
), completed_claims as materialized (
  -- Read the group's completion overlay once, not once per cached candidate.
  select keyword,final_keyword,
    coalesce((submitted_at at time zone 'Asia/Kuala_Lumpur')::date,claimed_date) as completed_date
  from member_claimed_keywords
  where p_group_id is not null and p_tab<>'wordLib'
    and group_id=p_group_id and status='submitted'
    and (submitted_at >= (coalesce(p_date,(now() at time zone 'Asia/Kuala_Lumpur')::date-6)::timestamp at time zone 'Asia/Kuala_Lumpur')
      or (submitted_at is null and claimed_date>=coalesce(p_date,(now() at time zone 'Asia/Kuala_Lumpur')::date-6)))
), completed_keywords as materialized (
  -- The most recent completion subsumes earlier ones for every older signal.
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
    case when p_direction='asc' then case p_sort when 'keyword' then item->>'keyword' when 'date' then item->>'last_date' end end asc nulls last,
    case when p_direction<>'asc' then case p_sort when 'keyword' then item->>'keyword' when 'date' then item->>'last_date' end end desc nulls last,
    case when p_direction='asc' and p_sort in ('volume','count','siteCount','rankDays','streak','change','netChange','long_tail_count','site_count') then coalesce(nullif(item->>p_sort,'')::numeric,0) end asc nulls last,
    case when p_direction<>'asc' and p_sort in ('volume','count','siteCount','rankDays','streak','change','netChange','long_tail_count','site_count') then coalesce(nullif(item->>p_sort,'')::numeric,0) end desc nulls last,
    coalesce((item->>'volume')::numeric,(item->>'count')::numeric,(item->>'long_tail_count')::numeric,0) desc,
    item->>'keyword',item->>'domain',signal_date desc) as position
  from eligible
)
-- A not-yet-built date must not block the other available dates in the window.
select jsonb_build_object('cacheReady',exists(select 1 from source),
 'date',coalesce(p_date::text,'all'),
 'cachedDates',coalesce((select jsonb_agg(data_date order by data_date desc) from source),'[]'::jsonb),
 'computedAt',(select min(computed_at) from source),'total',(select count(*) from eligible),
 'data',coalesce((select jsonb_agg(item order by position) from ranked cross join options
    where position>page::bigint*size and position<=(page::bigint+1)*size),'[]'::jsonb))
$$;

revoke all on function public.refresh_daily_radar_cache(date,text,text[],text[]) from public,anon,authenticated;
revoke all on function public.prune_daily_radar_cache() from public,anon,authenticated;
revoke all on function public.get_daily_radar_page(date,text,text,uuid,integer,integer,text,text,integer,integer,text,text,text) from public,anon,authenticated;
grant execute on function public.refresh_daily_radar_cache(date,text,text[],text[]) to service_role;
grant execute on function public.prune_daily_radar_cache() to service_role;
grant execute on function public.get_daily_radar_page(date,text,text,uuid,integer,integer,text,text,integer,integer,text,text,text) to service_role;
commit;
