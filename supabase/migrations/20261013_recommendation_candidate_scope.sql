-- Narrow recommendations to submitted terms/pages before reading rollup rows.
-- All original cooldown, ownership, dismissal, grouping and paging rules remain.
begin;
-- A hash avoids duplicating long URLs in a large expression index.
create index if not exists keyword_signal_recommendation_url_hash_idx
  on public.keyword_signal_rollup (
    site_id, md5(public.task_recommendation_url(latest_url)), last_seen desc
  ) where type = 'rankdown' and latest_url is not null;
grant execute on function public.task_recommendation_url(text) to service_role;

create or replace function public.get_task_group_recommendations_page(
  p_group_id uuid,
  p_user_ids uuid[],
  p_type text default 'rankdown',
  p_page integer default 0,
  p_page_size integer default 20,
  p_today date default ((timezone('Asia/Kuala_Lumpur', now()))::date)
)
returns jsonb language plpgsql stable security definer set search_path = public
as $function$
begin
  -- The common empty-member case must not inspect any ranking signals.
  if not exists (
    select 1 from public.member_claimed_keywords c
    join public.task_group_members m on m.group_id = c.group_id and m.user_id = c.user_id
    where c.group_id = p_group_id and c.user_id = any(coalesce(p_user_ids, '{}'::uuid[]))
      and c.status = 'submitted'
  ) then
    return jsonb_build_object('rows', '[]'::jsonb, 'total', 0,
      'page', greatest(0, least(coalesce(p_page,0),100000)),
      'pageSize', greatest(1, least(coalesce(p_page_size,20),100)));
  end if;
  return (
  with settings as (
    select greatest(0, least(coalesce(p_page, 0), 100000)) as page,
      greatest(1, least(coalesce(p_page_size, 20), 100)) as page_size
  ), members as materialized (
    select user_id, coalesce(username, '') as username
    from public.task_group_members
    where group_id = p_group_id and user_id = any(coalesce(p_user_ids, '{}'::uuid[]))
  ), own_sites as materialized (
    select s.id from public.sites s
    join public.task_groups g on g.id = p_group_id
    where lower(regexp_replace(regexp_replace(regexp_replace(btrim(s.domain), '^https?://', '', 'i'), '/.*$', ''), '\.$', ''))
      = any(array(select lower(regexp_replace(regexp_replace(regexp_replace(btrim(d), '^https?://', '', 'i'), '/.*$', ''), '\.$', '')) from unnest(g.site_domains) d))
  ), competitor_sites as materialized (
    select s.id from public.sites s
    where p_type = 'rankup' and not exists (
      select 1 from public.task_groups g cross join lateral unnest(g.site_domains) d
      where lower(regexp_replace(regexp_replace(regexp_replace(btrim(s.domain), '^https?://', '', 'i'), '/.*$', ''), '\.$', ''))
        = lower(regexp_replace(regexp_replace(regexp_replace(btrim(d), '^https?://', '', 'i'), '/.*$', ''), '\.$', ''))
    )
  ), claims as materialized (
    select c.*, lower(btrim(coalesce(nullif(c.final_keyword, ''), c.keyword))) as keyword_key,
      public.task_recommendation_url(c.page_url) as url_key,
      coalesce((c.submitted_at at time zone 'UTC')::date, c.claimed_date, (c.created_at at time zone 'UTC')::date) as submit_date
    from public.member_claimed_keywords c join members m on m.user_id = c.user_id
    where c.group_id = p_group_id and c.status = 'submitted'
  ), history as materialized (
    select user_id, keyword_key, max(submit_date) as last_submit_date,
      count(*) filter (where operation_type = '更新')::integer as update_count
    from claims group by user_id, keyword_key
  ), submitted_urls as materialized (
    select distinct user_id, url_key from claims where url_key <> ''
  ), latest_claim as materialized (
    -- Existing ownership rule: latest created submission for a keyword owns it.
    select distinct on (keyword_key) * from claims
    where p_type = 'rankup' and page_url is not null and page_url <> ''
    order by keyword_key, created_at desc, id
  ), signal_keys as materialized (
    -- Keyword identity needs at most one indexed lookup per submitted term.
    select keyword_key from history where p_type = 'rankdown'
    union
    -- URL-only ownership is preserved, without scanning every own-site signal.
    -- The md5 index is compact; the full comparison also excludes hash collisions.
    select lower(k.keyword) from submitted_urls u cross join own_sites s
    cross join lateral (
      select r.keyword from public.keyword_signal_rollup r
      where r.site_id = s.id and r.type = 'rankdown' and r.latest_url is not null
        and md5(public.task_recommendation_url(r.latest_url)) = md5(u.url_key)
        and public.task_recommendation_url(r.latest_url) = u.url_key
        and r.last_seen >= p_today - 30
      offset 0
    ) k
    where p_type = 'rankdown'
    union
    select keyword_key from latest_claim where p_type = 'rankup'
  ), signals as materialized (
    select k.keyword, lower(k.keyword) as keyword_key,
      k.last_seen as stat_date, k.latest_rank_position as rank_position,
      k.latest_prev_rank as prev_rank, coalesce(k.max_volume,0) as volume,
      k.latest_url as url, k.latest_title as title,
      public.task_recommendation_url(k.latest_url) as url_key
    from signal_keys keys cross join lateral (
      select r.* from public.keyword_signal_rollup r
      where lower(r.keyword) = keys.keyword_key and r.type = p_type
        and r.last_seen >= p_today - 30
        and exists (select 1 from own_sites)
        and ((p_type = 'rankdown' and r.site_id in (select id from own_sites))
          or (p_type = 'rankup' and r.site_id in (select id from competitor_sites)))
      order by r.last_seen desc, r.max_volume desc nulls last, r.site_id, r.keyword
      limit 1
    ) k
  ), candidates as (
    select s.*, m.user_id as member_id, m.username as member_name,
      s.url as own_url, null::text as own_created_at,
      case when h.last_submit_date is null then 0
        else p_today - (h.last_submit_date + 7 * (h.update_count + 1)) end as priority
    from signals s cross join members m
    left join history h on h.user_id = m.user_id and h.keyword_key = s.keyword_key
    where p_type = 'rankdown'
      and (h.user_id is not null or exists (select 1 from submitted_urls u where u.user_id = m.user_id and u.url_key = s.url_key))
    union all
    select s.*, m.user_id, m.username, c.page_url,
      coalesce(c.submitted_at::text, c.claimed_date::text, c.created_at::text),
      p_today - (h.last_submit_date + 7 * (h.update_count + 1))
    from signals s join latest_claim c on c.keyword_key = s.keyword_key
    join members m on m.user_id = c.user_id
    join history h on h.user_id = c.user_id and h.keyword_key = s.keyword_key
    where p_type = 'rankup' and s.stat_date >= c.submit_date
      and not exists (
        select 1 from public.site_keyword_ranks r
        where r.site_id in (select id from own_sites) and lower(r.keyword) = s.keyword_key
          and r.platform = 'mobile' and r.rank_position is not null and r.stat_date >= c.submit_date
      )
  ), eligible as materialized (
    select c.* from candidates c
    where c.priority >= 0 and not exists (
      select 1 from public.member_rec_dismissals d
      where d.group_id = p_group_id and d.user_id = c.member_id
        and lower(d.keyword) = c.keyword_key and d.dismissed_at >= now() - interval '7 days'
    )
  ), per_url as (
    select e.*, row_number() over (
      partition by member_id, case when p_type = 'rankdown' and url_key <> '' then url_key else keyword_key end
      order by priority, volume desc, stat_date desc, keyword
    ) as url_order from eligible e
  ), final_rows as materialized (
    select * from per_url where url_order = 1
  ), page_rows as (
    select * from final_rows order by priority, volume desc, stat_date desc, keyword, member_id
    limit (select page_size from settings)
    offset (select page::bigint * page_size from settings)
  ), rendered as (
    select p.*, case
      when p_type <> 'rankdown' then '[]'::jsonb
      when p.url_key = '' then jsonb_build_array(jsonb_build_object(
        'keyword',p.keyword,'rank_position',p.rank_position,'volume',p.volume))
      else (
        -- Only the current 20 page URLs need their complete same-page details.
        -- A term on that page can be absent from submission history, so look it
        -- up independently rather than taking only the recommendation candidates.
        with url_keys as (
          select distinct lower(r.keyword) as keyword_key
          from own_sites s cross join lateral (
            select r.keyword from public.keyword_signal_rollup r
            where r.site_id = s.id and r.type = 'rankdown' and r.latest_url is not null
              and md5(public.task_recommendation_url(r.latest_url)) = md5(p.url_key)
              and public.task_recommendation_url(r.latest_url) = p.url_key
              and r.last_seen >= p_today - 30
            offset 0
          ) r
        ), same_url as (
          select r.keyword,r.latest_rank_position as rank_position,coalesce(r.max_volume,0) as volume
          from url_keys u cross join lateral (
            select r.* from public.keyword_signal_rollup r
            where lower(r.keyword) = u.keyword_key and r.type = 'rankdown'
              and r.site_id in (select id from own_sites) and r.last_seen >= p_today - 30
            order by r.last_seen desc,r.max_volume desc nulls last,r.site_id,r.keyword
            limit 1
          ) r
          where public.task_recommendation_url(r.latest_url) = p.url_key
        )
        select coalesce(jsonb_agg(jsonb_build_object(
          'keyword',keyword,'rank_position',rank_position,'volume',volume
        ) order by volume desc,keyword),'[]'::jsonb) from same_url
      ) end as same_url_keywords
    from page_rows p
  )
  select jsonb_build_object(
    'rows', coalesce((select jsonb_agg(jsonb_build_object(
      'keyword', r.keyword, 'stat_date', r.stat_date, 'rank_position', r.rank_position,
      'prev_rank', r.prev_rank, 'volume', r.volume, 'url', r.url, 'title', r.title,
      'memberId', r.member_id, 'memberName', r.member_name, 'ownUrl', r.own_url,
      'ownCreatedAt', r.own_created_at, 'sameUrlCount', jsonb_array_length(r.same_url_keywords),
      'sameUrlKeywords', r.same_url_keywords
    ) order by r.priority, r.volume desc, r.stat_date desc, r.keyword, r.member_id) from rendered r), '[]'::jsonb),
    'total', (select count(*) from final_rows), 'page', (select page from settings),
    'pageSize', (select page_size from settings)
  )
  );
end;
$function$;

revoke all on function public.get_task_group_recommendations_page(uuid,uuid[],text,integer,integer,date) from public,anon,authenticated;
grant execute on function public.get_task_group_recommendations_page(uuid,uuid[],text,integer,integer,date) to service_role;
commit;
