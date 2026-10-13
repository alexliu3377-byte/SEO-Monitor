begin;

create or replace function public.get_site_rank_overview(
  p_site_id uuid,
  p_date_start date,
  p_date_end date,
  p_unstable_offset integer default 0,
  p_unstable_limit integer default 12
) returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with source as (
    select coalesce(has_rank_title, false) as has_rank_title from public.sites where id = p_site_id
  ), ranks as materialized (
    select r.keyword, r.volume, r.type, r.stat_date
    from public.rank_changes r cross join source s
    where not s.has_rank_title and r.site_id = p_site_id
      and r.stat_date between p_date_start and p_date_end
    union all
    select r.keyword, r.volume, r.type, r.stat_date
    from public.site_keyword_ranks r cross join source s
    where s.has_rank_title and r.site_id = p_site_id
      and r.platform = 'mobile' and r.volume > 0
      and r.stat_date between p_date_start and p_date_end
  ), latest as (
    select max(stat_date) as stat_date from ranks
  ), unstable as materialized (
    select keyword,
      coalesce(round(avg(volume) filter (where volume > 0)), 0)::bigint as volume,
      count(distinct stat_date) filter (where type = 'rankup')::integer as up_days,
      count(distinct stat_date) filter (where type = 'rankdown')::integer as down_days
    from ranks group by keyword
    having count(distinct stat_date) filter (where type = 'rankup') > 0
      and count(distinct stat_date) filter (where type = 'rankdown') > 0
      and count(distinct stat_date) filter (where type = 'rankup')
        + count(distinct stat_date) filter (where type = 'rankdown') >= 3
  )
  select jsonb_build_object(
    'rankDate', (select stat_date from latest),
    'rankupCount', (select count(*) from ranks where stat_date = (select stat_date from latest) and type = 'rankup'),
    'rankdownCount', (select count(*) from ranks where stat_date = (select stat_date from latest) and type = 'rankdown'),
    'rankup', coalesce((select jsonb_agg(to_jsonb(t) order by volume desc, keyword) from (
      select keyword, volume from ranks where stat_date = (select stat_date from latest) and type = 'rankup'
      order by volume desc nulls last, keyword limit 12
    ) t), '[]'::jsonb),
    'rankdown', coalesce((select jsonb_agg(to_jsonb(t) order by volume desc, keyword) from (
      select keyword, volume from ranks where stat_date = (select stat_date from latest) and type = 'rankdown'
      order by volume desc nulls last, keyword limit 12
    ) t), '[]'::jsonb),
    'unstableCount', (select count(*) from unstable),
    'unstable', coalesce((select jsonb_agg(jsonb_build_object(
      'keyword', keyword, 'volume', volume, 'upDays', up_days, 'downDays', down_days
    ) order by volume desc, keyword) from (
      select * from unstable order by volume desc, keyword
      offset greatest(p_unstable_offset, 0) limit greatest(1, least(p_unstable_limit, 500))
    ) t), '[]'::jsonb)
  );
$$;

revoke all on function public.get_site_rank_overview(uuid, date, date, integer, integer) from public, anon;
grant execute on function public.get_site_rank_overview(uuid, date, date, integer, integer) to authenticated, service_role;

commit;
