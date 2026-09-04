-- Replace the single multi-megabyte group tracking JSON read with a
-- normalized, server-side paginated cache. The legacy group_tracking_cache
-- row is kept so application deployments remain backwards compatible while
-- this migration and the first refresh are rolling out.
begin;

create table if not exists public.group_tracking_cache_state (
  group_id uuid primary key references public.task_groups(id) on delete cascade,
  computed_at timestamptz not null,
  row_count integer not null default 0 check (row_count >= 0),
  summary_payload jsonb not null default '{}'::jsonb
);

create table if not exists public.group_tracking_cache_rows (
  group_id uuid not null references public.task_groups(id) on delete cascade,
  claim_id uuid not null,
  user_id uuid not null,
  submit_date date not null,
  record_date date not null,
  keyword text not null,
  final_keyword text,
  operation_type text,
  search_volume bigint not null default 0,
  is_indexed boolean not null default false,
  effectiveness text not null,
  rank_keyword text,
  best_rank_position integer,
  total_rank_volume bigint not null default 0,
  score numeric not null default 0,
  payload jsonb not null,
  primary key (group_id, claim_id)
);

create index if not exists group_tracking_cache_rows_group_user_idx
  on public.group_tracking_cache_rows (group_id, user_id);
create index if not exists group_tracking_cache_rows_group_month_idx
  on public.group_tracking_cache_rows (group_id, submit_date);
create index if not exists group_tracking_cache_rows_group_effect_idx
  on public.group_tracking_cache_rows (group_id, effectiveness);
create index if not exists group_tracking_cache_rows_group_score_idx
  on public.group_tracking_cache_rows (group_id, score desc);
create index if not exists group_tracking_cache_rows_group_volume_idx
  on public.group_tracking_cache_rows (group_id, search_volume desc);
create index if not exists group_tracking_cache_rows_group_rank_idx
  on public.group_tracking_cache_rows (group_id, best_rank_position);
create index if not exists group_tracking_cache_rows_group_rank_volume_idx
  on public.group_tracking_cache_rows (group_id, total_rank_volume desc);

create or replace function public.replace_group_tracking_paged_cache(
  p_group_id uuid,
  p_rows jsonb,
  p_summary_payload jsonb,
  p_computed_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'p_rows must be a JSON array';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('group-tracking-cache|' || p_group_id::text, 0)
  );

  delete from public.group_tracking_cache_rows where group_id = p_group_id;

  insert into public.group_tracking_cache_rows (
    group_id, claim_id, user_id, submit_date, record_date, keyword,
    final_keyword, operation_type, search_volume, is_indexed, effectiveness,
    rank_keyword, best_rank_position, total_rank_volume, score, payload
  )
  select
    p_group_id,
    (item ->> 'claim_id')::uuid,
    (item ->> 'user_id')::uuid,
    (item ->> 'submit_date')::date,
    (item ->> 'record_date')::date,
    item ->> 'keyword',
    item ->> 'final_keyword',
    item ->> 'operation_type',
    coalesce((item ->> 'search_volume')::bigint, 0),
    coalesce((item ->> 'is_indexed')::boolean, false),
    item ->> 'effectiveness',
    item ->> 'rank_keyword',
    (item ->> 'bestRankPosition')::integer,
    coalesce((item ->> 'totalRankVolume')::bigint, 0),
    coalesce((item ->> 'score')::numeric, 0),
    item
  from pg_catalog.jsonb_array_elements(p_rows) as source(item);

  insert into public.group_tracking_cache_state (
    group_id, computed_at, row_count, summary_payload
  ) values (
    p_group_id, p_computed_at, pg_catalog.jsonb_array_length(p_rows),
    coalesce(p_summary_payload, '{}'::jsonb)
  )
  on conflict (group_id) do update set
    computed_at = excluded.computed_at,
    row_count = excluded.row_count,
    summary_payload = excluded.summary_payload;

  -- Keep the old cache populated until every deployed application instance is
  -- running code that understands the paged cache.
  insert into public.group_tracking_cache (group_id, payload, computed_at)
  values (p_group_id, p_rows, p_computed_at)
  on conflict (group_id) do update set
    payload = excluded.payload,
    computed_at = excluded.computed_at;
end
$$;

alter function public.replace_group_tracking_paged_cache(uuid, jsonb, jsonb, timestamptz)
  set statement_timeout = '60s';

create or replace function public.get_group_tracking_outcomes_page(
  p_group_id uuid,
  p_visible_user_id uuid default null,
  p_member_id uuid default null,
  p_operation_type text default '',
  p_keyword text default '',
  p_indexed text default '',
  p_rank_keyword text default '',
  p_effectiveness text default '',
  p_sort_by text default 'score',
  p_sort_dir text default 'desc',
  p_offset integer default 0,
  p_limit integer default 20
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_computed_at timestamptz;
  v_expected_rows integer;
  v_actual_rows integer;
  v_result jsonb;
begin
  select computed_at, row_count
  into v_computed_at, v_expected_rows
  from public.group_tracking_cache_state
  where group_id = p_group_id;

  if v_computed_at is null or v_computed_at < pg_catalog.now() - interval '26 hours' then
    return null;
  end if;

  select count(*)::integer into v_actual_rows
  from public.group_tracking_cache_rows where group_id = p_group_id;
  if v_actual_rows <> v_expected_rows then return null; end if;

  with base as (
    select r.*
    from public.group_tracking_cache_rows r
    where r.group_id = p_group_id
      and (p_visible_user_id is null or r.user_id = p_visible_user_id)
      and (coalesce(p_operation_type, '') = '' or r.operation_type = p_operation_type)
      and (coalesce(p_effectiveness, '') = '' or r.effectiveness = p_effectiveness)
      and (
        coalesce(p_keyword, '') = ''
        or pg_catalog.lower(r.keyword) like '%' || pg_catalog.lower(p_keyword) || '%'
        or pg_catalog.lower(coalesce(r.final_keyword, '')) like '%' || pg_catalog.lower(p_keyword) || '%'
      )
      and (
        coalesce(p_indexed, '') = ''
        or (p_indexed = 'has' and r.is_indexed)
        or (p_indexed = 'none' and not r.is_indexed)
      )
      and (
        coalesce(p_rank_keyword, '') = ''
        or pg_catalog.lower(coalesce(r.rank_keyword, '')) like '%' || pg_catalog.lower(p_rank_keyword) || '%'
      )
  ),
  selected as (
    select * from base
    where p_member_id is null or user_id = p_member_id
  ),
  ordered as (
    select selected.*,
      pg_catalog.row_number() over (order by
        case when p_sort_by = 'search_volume' and p_sort_dir = 'asc' then search_volume end asc,
        case when p_sort_by = 'search_volume' and p_sort_dir <> 'asc' then search_volume end desc,
        case when p_sort_by = 'rank_position' then best_rank_position is null end asc,
        case when p_sort_by = 'rank_position' and p_sort_dir = 'asc' then best_rank_position end asc,
        case when p_sort_by = 'rank_position' and p_sort_dir <> 'asc' then best_rank_position end desc,
        case when p_sort_by = 'rank_volume' and p_sort_dir = 'asc' then total_rank_volume end asc,
        case when p_sort_by = 'rank_volume' and p_sort_dir <> 'asc' then total_rank_volume end desc,
        case when p_sort_by = 'score' and p_sort_dir = 'asc' then score end asc,
        case when p_sort_by = 'score' and p_sort_dir <> 'asc' then score end desc,
        case when p_sort_by = 'record_date' and p_sort_dir = 'asc' then record_date end asc,
        case when p_sort_by = 'record_date' and p_sort_dir <> 'asc' then record_date end desc,
        case when p_sort_by not in ('search_volume', 'rank_position', 'rank_volume', 'score', 'record_date') and p_sort_dir = 'asc' then submit_date end asc,
        case when p_sort_by not in ('search_volume', 'rank_position', 'rank_volume', 'score', 'record_date') and p_sort_dir <> 'asc' then submit_date end desc,
        claim_id asc
      ) as ordinal
    from selected
  ),
  page_rows as (
    select * from ordered
    where ordinal > greatest(coalesce(p_offset, 0), 0)
      and ordinal <= greatest(coalesce(p_offset, 0), 0)
        + least(greatest(coalesce(p_limit, 20), 1), 200)
  ),
  group_totals as (
    select
      count(*)::integer as total,
      count(*) filter (where effectiveness = '获取排名')::integer as ranked,
      count(*) filter (where effectiveness = '获取收录')::integer as indexed,
      count(*) filter (where effectiveness = '追踪中')::integer as tracking,
      count(*) filter (where effectiveness = '无效')::integer as invalid
    from base
  ),
  selected_totals as (
    select
      count(*)::integer as total,
      count(*) filter (where effectiveness = '获取排名')::integer as ranked,
      count(*) filter (where effectiveness = '获取收录')::integer as indexed,
      count(*) filter (where effectiveness = '追踪中')::integer as tracking,
      count(*) filter (where effectiveness = '无效')::integer as invalid
    from selected
  )
  select pg_catalog.jsonb_build_object(
    'rows', coalesce((select pg_catalog.jsonb_agg(payload order by ordinal) from page_rows), '[]'::jsonb),
    'summary', pg_catalog.jsonb_build_object(
      'total', s.total, 'rankedCount', s.ranked, 'indexedCount', s.indexed,
      'trackingCount', s.tracking, 'invalidCount', s.invalid
    ),
    'groupSummary', pg_catalog.jsonb_build_object(
      'total', g.total, 'rankedCount', g.ranked, 'indexedCount', g.indexed,
      'trackingCount', g.tracking, 'invalidCount', g.invalid
    ),
    'totalRows', s.total,
    'computedAt', v_computed_at,
    'fromCache', true
  ) into v_result
  from selected_totals s cross join group_totals g;

  return v_result;
end
$$;

create or replace function public.invalidate_group_tracking_paged_cache(p_group_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  delete from public.group_tracking_cache_rows where group_id = p_group_id;
  delete from public.group_tracking_cache_state where group_id = p_group_id;
  delete from public.group_tracking_cache where group_id = p_group_id;
end
$$;

create or replace function public.get_group_tracking_detail_page(
  p_group_id uuid,
  p_start_date date,
  p_end_date date,
  p_effectiveness text,
  p_scope_user_id uuid default null,
  p_rank_min integer default null,
  p_rank_max integer default null,
  p_offset integer default 0,
  p_limit integer default 50
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_computed_at timestamptz;
  v_expected_rows integer;
  v_actual_rows integer;
  v_result jsonb;
begin
  select computed_at, row_count
  into v_computed_at, v_expected_rows
  from public.group_tracking_cache_state
  where group_id = p_group_id;

  if v_computed_at is null or v_computed_at < pg_catalog.now() - interval '26 hours' then
    return null;
  end if;

  select count(*)::integer into v_actual_rows
  from public.group_tracking_cache_rows where group_id = p_group_id;
  if v_actual_rows <> v_expected_rows then return null; end if;

  if p_rank_min is null or p_rank_max is null then
    with selected as (
      select
        pg_catalog.jsonb_build_object(
          'user_id', user_id,
          'keyword', keyword,
          'final_keyword', final_keyword,
          'search_volume', search_volume,
          'source', coalesce(payload ->> 'source', '未知'),
          'operation_type', operation_type,
          'username', payload ->> 'username'
        ) as item,
        search_volume,
        claim_id
      from public.group_tracking_cache_rows
      where group_id = p_group_id
        and submit_date between p_start_date and p_end_date
        and effectiveness = p_effectiveness
        and (p_scope_user_id is null or user_id = p_scope_user_id)
    ), ordered as (
      select selected.*,
        pg_catalog.row_number() over (order by search_volume desc, claim_id asc) as ordinal
      from selected
    ), page_rows as (
      select * from ordered
      where ordinal > greatest(coalesce(p_offset, 0), 0)
        and ordinal <= greatest(coalesce(p_offset, 0), 0)
          + least(greatest(coalesce(p_limit, 50), 1), 200)
    )
    select pg_catalog.jsonb_build_object(
      'rows', coalesce((select pg_catalog.jsonb_agg(item order by ordinal) from page_rows), '[]'::jsonb),
      'total', (select count(*)::integer from selected),
      'computedAt', v_computed_at,
      'fromCache', true
    ) into v_result;
  else
    with expanded as (
      select
        r.claim_id,
        r.user_id,
        r.keyword,
        r.final_keyword,
        r.operation_type,
        coalesce(r.payload ->> 'source', '未知') as source,
        r.payload ->> 'username' as username,
        (match ->> 'rank_position')::integer as rank_position,
        match ->> 'keyword' as rank_keyword,
        coalesce((match ->> 'volume')::bigint, 0) as rank_volume
      from public.group_tracking_cache_rows r
      cross join lateral pg_catalog.jsonb_array_elements(
        case
          when pg_catalog.jsonb_array_length(coalesce(r.payload -> 'rank_matches', '[]'::jsonb)) > 0
            then r.payload -> 'rank_matches'
          else pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
            'keyword', coalesce(r.rank_keyword, r.keyword),
            'rank_position', r.payload -> 'rank_position',
            'volume', r.payload -> 'rank_volume'
          ))
        end
      ) as matches(match)
      where r.group_id = p_group_id
        and r.submit_date between p_start_date and p_end_date
        and r.effectiveness = p_effectiveness
        and (p_scope_user_id is null or r.user_id = p_scope_user_id)
    ), selected as (
      select
        pg_catalog.jsonb_build_object(
          'user_id', user_id,
          'keyword', keyword,
          'final_keyword', final_keyword,
          'rank_position', rank_position,
          'rank_keyword', rank_keyword,
          'rank_volume', rank_volume,
          'source', source,
          'operation_type', operation_type,
          'username', username
        ) as item,
        rank_volume,
        claim_id,
        rank_keyword
      from expanded
      where rank_position between p_rank_min and p_rank_max
    ), ordered as (
      select selected.*,
        pg_catalog.row_number() over (order by rank_volume desc, claim_id asc, rank_keyword asc) as ordinal
      from selected
    ), page_rows as (
      select * from ordered
      where ordinal > greatest(coalesce(p_offset, 0), 0)
        and ordinal <= greatest(coalesce(p_offset, 0), 0)
          + least(greatest(coalesce(p_limit, 50), 1), 200)
    )
    select pg_catalog.jsonb_build_object(
      'rows', coalesce((select pg_catalog.jsonb_agg(item order by ordinal) from page_rows), '[]'::jsonb),
      'total', (select count(*)::integer from selected),
      'computedAt', v_computed_at,
      'fromCache', true
    ) into v_result;
  end if;

  return v_result;
end
$$;

revoke all on table public.group_tracking_cache_state from public, anon, authenticated;
revoke all on table public.group_tracking_cache_rows from public, anon, authenticated;
grant all on table public.group_tracking_cache_state to service_role;
grant all on table public.group_tracking_cache_rows to service_role;

revoke all on function public.replace_group_tracking_paged_cache(uuid, jsonb, jsonb, timestamptz) from public;
revoke all on function public.invalidate_group_tracking_paged_cache(uuid) from public;
revoke all on function public.get_group_tracking_outcomes_page(uuid, uuid, uuid, text, text, text, text, text, text, text, integer, integer) from public;
revoke all on function public.get_group_tracking_detail_page(uuid, date, date, text, uuid, integer, integer, integer, integer) from public;
grant execute on function public.replace_group_tracking_paged_cache(uuid, jsonb, jsonb, timestamptz) to service_role;
grant execute on function public.invalidate_group_tracking_paged_cache(uuid) to service_role;
grant execute on function public.get_group_tracking_outcomes_page(uuid, uuid, uuid, text, text, text, text, text, text, text, integer, integer) to service_role;
grant execute on function public.get_group_tracking_detail_page(uuid, date, date, text, uuid, integer, integer, integer, integer) to service_role;

commit;
