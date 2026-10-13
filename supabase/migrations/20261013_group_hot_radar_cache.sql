-- Ready-to-render hot-radar result for each task group. The underlying crawl
-- rows and the global radar cache remain shared; this table stores only the
-- result filtered by each group's rank_domains/new_domains selection.
create table if not exists public.group_hot_radar_cache (
  group_id uuid primary key references public.task_groups(id) on delete cascade,
  payload jsonb not null,
  filter_hash text not null,
  source_computed_at timestamptz not null,
  computed_at timestamptz not null default now()
);

create index if not exists idx_group_hot_radar_cache_computed_at
  on public.group_hot_radar_cache (computed_at desc);

alter table public.group_hot_radar_cache enable row level security;
revoke all on table public.group_hot_radar_cache from public, anon, authenticated;
grant all on table public.group_hot_radar_cache to service_role;
