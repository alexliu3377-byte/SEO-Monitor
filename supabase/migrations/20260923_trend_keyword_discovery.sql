-- Keep search recommendations separate from post/video evidence. They are
-- leads for future collection, not proof that a trend already exists.
begin;

create table if not exists public.trend_search_terms (
  id uuid primary key default gen_random_uuid(),
  normalized_term text not null unique check (char_length(normalized_term) between 2 and 80),
  display_term text not null check (char_length(btrim(display_term)) between 2 and 80),
  review_status text not null default 'pending'
    check (review_status in ('pending', 'added', 'ignored')),
  added_platforms text[] not null default '{}'
    check (added_platforms <@ array['xiaohongshu', 'douyin']::text[]),
  first_seen_at timestamptz not null,
  last_seen_at timestamptz not null,
  reviewed_by uuid references public.user_profiles(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.trend_search_observations (
  id bigint generated always as identity primary key,
  term_id uuid not null references public.trend_search_terms(id) on delete cascade,
  platform text not null check (platform in ('xiaohongshu', 'douyin')),
  source_kind text not null check (source_kind in ('related_search', 'everyone_search')),
  seed_query text not null check (char_length(btrim(seed_query)) between 2 and 40),
  position smallint check (position is null or position between 1 and 100),
  observed_on date not null,
  first_seen_at timestamptz not null,
  last_seen_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (term_id, platform, source_kind, seed_query, observed_on)
);

create index if not exists trend_search_terms_board_idx
  on public.trend_search_terms (review_status, last_seen_at desc);
create index if not exists trend_search_observations_term_idx
  on public.trend_search_observations (term_id, last_seen_at desc);

drop trigger if exists touch_trend_search_terms_updated_at on public.trend_search_terms;
create trigger touch_trend_search_terms_updated_at
before update on public.trend_search_terms
for each row execute function public.touch_trend_discovery_updated_at();

create or replace function public.add_trend_collection_query(
  p_platform text,
  p_query text,
  p_actor uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_query text := btrim(p_query);
  v_normalized text := lower(btrim(p_query));
  v_sort_order integer;
begin
  if p_actor is null then
    raise exception using errcode = '22023', message = 'actor is required';
  end if;
  if p_platform not in ('xiaohongshu', 'douyin') then
    raise exception using errcode = '22023', message = 'platform is invalid';
  end if;
  if char_length(v_query) not between 2 and 40 then
    raise exception using errcode = '22023', message = 'query length is invalid';
  end if;

  lock table public.trend_collection_queries in share row exclusive mode;

  update public.trend_collection_queries
  set enabled = true, query = v_query, updated_by = p_actor, updated_at = now()
  where platform = p_platform and normalized_query = v_normalized;
  if found then return; end if;

  select coalesce(max(sort_order), 0) + 1
  into v_sort_order
  from public.trend_collection_queries
  where platform = p_platform;
  if v_sort_order > 500 then
    raise exception using errcode = '22023', message = 'query limit reached';
  end if;

  insert into public.trend_collection_queries (
    platform, query, normalized_query, sort_order, enabled, created_by, updated_by
  ) values (
    p_platform, v_query, v_normalized, v_sort_order, true, p_actor, p_actor
  );
end
$$;

alter table public.trend_search_terms enable row level security;
alter table public.trend_search_observations enable row level security;
revoke all on table public.trend_search_terms from public, anon, authenticated;
revoke all on table public.trend_search_observations from public, anon, authenticated;
grant all on table public.trend_search_terms to service_role;
grant all on table public.trend_search_observations to service_role;
revoke all on function public.add_trend_collection_query(text, text, uuid) from public, anon, authenticated;
grant execute on function public.add_trend_collection_query(text, text, uuid) to service_role;

commit;
