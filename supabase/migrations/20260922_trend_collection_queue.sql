-- Let a dedicated collector repository claim small trend-search jobs around
-- the clock without two runners processing the same query at the same time.
begin;

alter table public.trend_collection_queries
  drop constraint if exists trend_collection_queries_sort_order_check;
alter table public.trend_collection_queries
  add constraint trend_collection_queries_sort_order_check
  check (sort_order between 1 and 500);

alter table public.trend_collection_queries
  add column if not exists last_dispatched_at timestamptz,
  add column if not exists lease_expires_at timestamptz,
  add column if not exists last_dispatched_to text;

create index if not exists trend_collection_queries_dispatch_idx
  on public.trend_collection_queries (
    enabled, lease_expires_at, last_dispatched_at, platform, sort_order
  );

create or replace function public.replace_trend_collection_queries(
  p_xiaohongshu text[],
  p_douyin text[],
  p_actor uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if p_actor is null then
    raise exception using errcode = '22023', message = 'actor is required';
  end if;
  if coalesce(cardinality(p_xiaohongshu), 0) not between 1 and 100 then
    raise exception using errcode = '22023', message = 'xiaohongshu queries must contain 1 to 100 items';
  end if;
  if coalesce(cardinality(p_douyin), 0) not between 1 and 100 then
    raise exception using errcode = '22023', message = 'douyin queries must contain 1 to 100 items';
  end if;
  if exists (
    select 1
    from unnest(p_xiaohongshu || p_douyin) as item(query)
    where item.query is null or char_length(btrim(item.query)) not between 2 and 40
  ) then
    raise exception using errcode = '22023', message = 'query length is invalid';
  end if;
  if exists (
    select 1 from (
      select lower(btrim(item.query))
      from unnest(p_xiaohongshu) as item(query)
      group by lower(btrim(item.query)) having count(*) > 1
    ) duplicates
  ) or exists (
    select 1 from (
      select lower(btrim(item.query))
      from unnest(p_douyin) as item(query)
      group by lower(btrim(item.query)) having count(*) > 1
    ) duplicates
  ) then
    raise exception using errcode = '22023', message = 'queries must be unique within a platform';
  end if;

  delete from public.trend_collection_queries
  where platform in ('xiaohongshu', 'douyin');

  insert into public.trend_collection_queries (
    platform, query, normalized_query, sort_order, enabled, created_by, updated_by
  )
  select 'xiaohongshu', btrim(item.query), lower(btrim(item.query)), item.ordinality::smallint,
    true, p_actor, p_actor
  from unnest(p_xiaohongshu) with ordinality as item(query, ordinality);

  insert into public.trend_collection_queries (
    platform, query, normalized_query, sort_order, enabled, created_by, updated_by
  )
  select 'douyin', btrim(item.query), lower(btrim(item.query)), item.ordinality::smallint,
    true, p_actor, p_actor
  from unnest(p_douyin) with ordinality as item(query, ordinality);
end
$$;

create or replace function public.claim_trend_collection_query(
  p_node_id text
)
returns table (
  id uuid,
  platform text,
  query text
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_query_id uuid;
begin
  if p_node_id is null or p_node_id !~ '^[a-z0-9][a-z0-9_-]{2,63}$' then
    raise exception using errcode = '22023', message = 'invalid trend collector node id';
  end if;

  select query_row.id
  into v_query_id
  from public.trend_collection_queries query_row
  where query_row.enabled = true
    and (query_row.lease_expires_at is null or query_row.lease_expires_at <= clock_timestamp())
    and (
      query_row.last_dispatched_at is null
      or query_row.last_dispatched_at <= clock_timestamp() - interval '12 hours'
    )
  order by
    (
      select max(platform_row.last_dispatched_at)
      from public.trend_collection_queries platform_row
      where platform_row.platform = query_row.platform
        and platform_row.enabled = true
    ) asc nulls first,
    query_row.last_dispatched_at asc nulls first,
    query_row.sort_order asc,
    query_row.id asc
  for update of query_row skip locked
  limit 1;

  if v_query_id is null then
    return;
  end if;

  return query
  update public.trend_collection_queries claimed
  set
    last_dispatched_at = clock_timestamp(),
    lease_expires_at = clock_timestamp() + interval '90 minutes',
    last_dispatched_to = p_node_id,
    updated_at = clock_timestamp()
  where claimed.id = v_query_id
  returning claimed.id, claimed.platform, claimed.query;
end
$$;

revoke all on function public.claim_trend_collection_query(text) from public, anon, authenticated;
grant execute on function public.claim_trend_collection_query(text) to service_role;
revoke all on function public.replace_trend_collection_queries(text[], text[], uuid) from public, anon, authenticated;
grant execute on function public.replace_trend_collection_queries(text[], text[], uuid) to service_role;

commit;
