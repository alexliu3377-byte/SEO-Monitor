-- Aggregate inside the selected site scope BEFORE ranking/limiting. Returning
-- a single JSON value avoids the PostgREST per-request row cap on radar RPCs.
begin;
create or replace function public.compute_scoped_hot_radar(
  p_rank_domains text[] default '{}',
  p_new_domains text[] default '{}',
  p_since date default ((now() at time zone 'Asia/Kuala_Lumpur')::date - 30),
  p_limit integer default 2000
) returns jsonb language sql stable security definer
set search_path = public, pg_temp
set statement_timeout = '45s'
as $function$
with new_sites as materialized (
  select id, domain from public.sites
  where coalesce(cardinality(p_new_domains), 0) = 0
     or lower(regexp_replace(domain, '^www\.', '', 'i')) = any(p_new_domains)
), new_rows as materialized (
  select rk.keyword, rk.site_id, s.domain,
    coalesce(rk.content_date, (rk.discovered_at at time zone 'Asia/Kuala_Lumpur')::date) as seen_date
  from public.raw_keywords rk join new_sites s on s.id = rk.site_id
  where rk.discovered_at >= (p_since::timestamp at time zone 'Asia/Kuala_Lumpur')
), new_words as (
  select keyword, count(*) as total_count, count(distinct site_id) as site_count,
    array_agg(distinct domain order by domain) as sites,
    min(seen_date) as first_date, max(seen_date) as last_date
  from new_rows group by keyword
  having count(distinct site_id) >= case when coalesce(cardinality(p_new_domains),0) = 0 then 2 else 1 end
  order by max(seen_date) desc, count(*) desc, keyword
  limit greatest(1, least(p_limit, 5000))
), rank_sites as materialized (
  select id, domain from public.sites
  where coalesce(cardinality(p_rank_domains), 0) = 0
     or lower(regexp_replace(domain, '^www\.', '', 'i')) = any(p_rank_domains)
), rank_rows as materialized (
  select r.keyword, r.site_id, s.domain, r.max_volume,
    r.first_seen, r.last_seen,
    array(select d from unnest(r.recent_dates) d where d >= p_since order by d) as dates
  from public.keyword_signal_rollup r join rank_sites s on s.id = r.site_id
  where r.type = 'rankup' and r.last_seen >= p_since
), rank_words as (
  select keyword, count(distinct site_id) as site_count,
    coalesce(max(max_volume),0) as volume,
    array_agg(distinct domain order by domain) as sites,
    min(coalesce(dates[1], first_seen)) as first_date, max(last_seen) as last_date,
    max(cardinality(dates)) as rank_days
  from rank_rows group by keyword
  order by max(last_seen) desc, max(cardinality(dates)) desc, coalesce(max(max_volume),0) desc, keyword
  limit greatest(1, least(p_limit, 5000))
), streak_words as (
  select keyword, domain, cardinality(dates) as streak, coalesce(max_volume,0) as volume,
    coalesce(dates[1],first_seen) as first_date, last_seen as last_date
  from rank_rows where cardinality(dates) >= 2
  order by last_seen desc, cardinality(dates) desc, coalesce(max_volume,0) desc, keyword, domain
  limit greatest(1, least(p_limit, 5000))
)
select jsonb_build_object(
  'newWords', coalesce((select jsonb_agg(jsonb_build_object(
    'keyword',keyword,'count',total_count,'siteCount',site_count,'sites',sites,
    'first_date',first_date,'last_date',last_date
  ) order by last_date desc, total_count desc, keyword) from new_words),'[]'::jsonb),
  'rankWords', coalesce((select jsonb_agg(jsonb_build_object(
    'keyword',keyword,'siteCount',site_count,'volume',volume,'sites',sites,
    'first_date',first_date,'last_date',last_date,'rankDays',rank_days
  ) order by last_date desc, rank_days desc, volume desc, keyword) from rank_words),'[]'::jsonb),
  'streakWords', coalesce((select jsonb_agg(jsonb_build_object(
    'keyword',keyword,'domain',domain,'streak',streak,'volume',volume,
    'first_date',first_date,'last_date',last_date
  ) order by last_date desc, streak desc, volume desc, keyword, domain) from streak_words),'[]'::jsonb)
);
$function$;

revoke all on function public.compute_scoped_hot_radar(text[],text[],date,integer) from public,anon,authenticated;
grant execute on function public.compute_scoped_hot_radar(text[],text[],date,integer) to service_role;

create table if not exists public.wordlib_cache (
  id text primary key,
  payload jsonb not null,
  computed_at timestamptz not null default now()
);
alter table public.wordlib_cache enable row level security;
revoke all on public.wordlib_cache from public,anon,authenticated;
grant all on public.wordlib_cache to service_role;

-- JSON result also prevents silently losing word-library rows at REST's cap.
create or replace function public.compute_scoped_wordlib(p_new_domains text[] default '{}')
returns jsonb language sql stable security definer
set search_path = public, pg_temp
set statement_timeout = '45s'
as $function$
with deduped as materialized (
  select distinct on (rk.site_id,rk.keyword) s.domain,rk.keyword,
    coalesce(rk.content_date,(rk.discovered_at at time zone 'Asia/Kuala_Lumpur')::date) as kw_date
  from public.raw_keywords rk join public.sites s on s.id=rk.site_id
  where rk.discovered_at >= (((now() at time zone 'Asia/Kuala_Lumpur')::date - 30)::timestamp at time zone 'Asia/Kuala_Lumpur')
    and (coalesce(cardinality(p_new_domains),0)=0
      or lower(regexp_replace(s.domain,'^www\.','','i'))=any(p_new_domains))
  order by rk.site_id,rk.keyword,rk.discovered_at desc
), unique_kws as materialized (select distinct keyword from deduped),
actual_bases as (
  select k.keyword,min(length(b.keyword)) as base_length
  from unique_kws k cross join lateral generate_series(1,length(k.keyword)-1) span(n)
  join unique_kws b on b.keyword=left(k.keyword,n)
  group by k.keyword
), keyword_base as (
  select k.keyword,coalesce(left(k.keyword,a.base_length),k.keyword) as base
  from unique_kws k left join actual_bases a on a.keyword=k.keyword
), grouped as (
  select kb.base as keyword,count(distinct kb.keyword)::int as long_tail_count,
    count(distinct d.domain)::int as site_count,array_agg(distinct d.domain order by d.domain) as sites,
    max(d.kw_date) as last_date
  from keyword_base kb join deduped d on d.keyword=kb.keyword
  group by kb.base having count(distinct kb.keyword)>=2
)
select coalesce(jsonb_agg(to_jsonb(g) order by last_date desc,long_tail_count desc,site_count desc,keyword),'[]'::jsonb)
from grouped g;
$function$;
revoke all on function public.compute_scoped_wordlib(text[]) from public,anon,authenticated;
grant execute on function public.compute_scoped_wordlib(text[]) to service_role;

alter table public.group_hot_radar_cache add column if not exists wordlib_payload jsonb;
alter table public.group_hot_radar_cache add column if not exists section_updated_at jsonb not null default '{}';
alter table public.hot_radar_cache add column if not exists section_updated_at jsonb not null default '{}';
alter table public.hot_radar_cache add column if not exists failed_sections text[] not null default '{}';

create or replace function public.get_latest_visible_site_weights()
returns table(site_id uuid,pc_weight integer,mobile_weight integer,record_date date)
language sql stable security invoker set search_path=public,pg_temp
as $function$
  select distinct on (h.site_id) h.site_id,h.pc_weight::integer,h.mobile_weight::integer,h.record_date
  from public.weight_history h order by h.site_id,h.record_date desc,h.id desc;
$function$;
revoke all on function public.get_latest_visible_site_weights() from public,anon;
grant execute on function public.get_latest_visible_site_weights() to authenticated,service_role;
commit;
