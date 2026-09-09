-- Let the project owner maintain the search-entry terms used by the local
-- trend collector. Collectors only receive enabled terms through the
-- service-authenticated application endpoint.
begin;

create table if not exists public.trend_collection_queries (
  id uuid primary key default gen_random_uuid(),
  platform text not null check (platform in ('xiaohongshu', 'douyin')),
  query text not null check (char_length(btrim(query)) between 2 and 40),
  normalized_query text not null check (char_length(normalized_query) between 2 and 40),
  sort_order smallint not null check (sort_order between 1 and 20),
  enabled boolean not null default true,
  created_by uuid references public.user_profiles(id) on delete set null,
  updated_by uuid references public.user_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (platform, normalized_query),
  unique (platform, sort_order)
);

create index if not exists trend_collection_queries_enabled_idx
  on public.trend_collection_queries (platform, sort_order)
  where enabled = true;

drop trigger if exists touch_trend_collection_queries_updated_at
  on public.trend_collection_queries;
create trigger touch_trend_collection_queries_updated_at
before update on public.trend_collection_queries
for each row execute function public.touch_trend_discovery_updated_at();

insert into public.trend_collection_queries (
  platform, query, normalized_query, sort_order
)
values
  ('xiaohongshu', '新游戏', '新游戏', 1),
  ('xiaohongshu', '新手游', '新手游', 2),
  ('xiaohongshu', '宝藏游戏', '宝藏游戏', 3),
  ('xiaohongshu', '新APP', '新app', 4),
  ('xiaohongshu', '宝藏APP', '宝藏app', 5),
  ('xiaohongshu', '效率工具', '效率工具', 6),
  ('xiaohongshu', '新软件', '新软件', 7),
  ('xiaohongshu', '实用工具', '实用工具', 8),
  ('douyin', '新游戏', '新游戏', 1),
  ('douyin', '宝藏游戏', '宝藏游戏', 2),
  ('douyin', '新APP', '新app', 3),
  ('douyin', '效率工具', '效率工具', 4)
on conflict do nothing;

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
  if coalesce(cardinality(p_xiaohongshu), 0) not between 1 and 8 then
    raise exception using errcode = '22023', message = 'xiaohongshu queries must contain 1 to 8 items';
  end if;
  if coalesce(cardinality(p_douyin), 0) not between 1 and 4 then
    raise exception using errcode = '22023', message = 'douyin queries must contain 1 to 4 items';
  end if;
  if exists (
    select 1
    from unnest(p_xiaohongshu || p_douyin) as item(query)
    where item.query is null
      or char_length(btrim(item.query)) not between 2 and 40
  ) then
    raise exception using errcode = '22023', message = 'query length is invalid';
  end if;
  if exists (
    select 1
    from (
      select lower(btrim(item.query)) as query
      from unnest(p_xiaohongshu) as item(query)
      group by lower(btrim(item.query))
      having count(*) > 1
    ) duplicates
  ) or exists (
    select 1
    from (
      select lower(btrim(item.query)) as query
      from unnest(p_douyin) as item(query)
      group by lower(btrim(item.query))
      having count(*) > 1
    ) duplicates
  ) then
    raise exception using errcode = '22023', message = 'queries must be unique within a platform';
  end if;

  delete from public.trend_collection_queries
  where platform in ('xiaohongshu', 'douyin');

  insert into public.trend_collection_queries (
    platform, query, normalized_query, sort_order, enabled, created_by, updated_by
  )
  select
    'xiaohongshu', btrim(item.query), lower(btrim(item.query)), item.ordinality::smallint,
    true, p_actor, p_actor
  from unnest(p_xiaohongshu) with ordinality as item(query, ordinality);

  insert into public.trend_collection_queries (
    platform, query, normalized_query, sort_order, enabled, created_by, updated_by
  )
  select
    'douyin', btrim(item.query), lower(btrim(item.query)), item.ordinality::smallint,
    true, p_actor, p_actor
  from unnest(p_douyin) with ordinality as item(query, ordinality);
end
$$;

alter table public.trend_collection_queries enable row level security;
revoke all on table public.trend_collection_queries from public, anon, authenticated;
grant all on table public.trend_collection_queries to service_role;

revoke all on function public.replace_trend_collection_queries(text[], text[], uuid) from public;
grant execute on function public.replace_trend_collection_queries(text[], text[], uuid) to service_role;

commit;
