-- Social trend discovery foundation.
-- Collectors send only minimal public metadata through the application ingest
-- endpoint. Raw signals, metric snapshots, candidate terms and collector
-- health are stored separately so collectors can be replaced independently.
begin;

create table if not exists public.trend_collector_nodes (
  id text primary key check (id ~ '^[a-z0-9][a-z0-9_-]{2,63}$'),
  name text not null check (char_length(btrim(name)) between 2 and 80),
  collector_version text not null check (char_length(btrim(collector_version)) between 1 and 30),
  platforms text[] not null default '{}'::text[]
    check (platforms <@ array['xiaohongshu', 'douyin', 'xiaoheihe']::text[]),
  status text not null default 'offline'
    check (status in ('online', 'offline', 'blocked', 'error')),
  last_seen_at timestamptz,
  last_success_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.trend_collection_runs (
  id uuid primary key,
  node_id text not null references public.trend_collector_nodes(id) on delete restrict,
  platform text not null check (platform in ('xiaohongshu', 'douyin', 'xiaoheihe')),
  status text not null check (status in ('completed', 'failed', 'blocked')),
  started_at timestamptz not null,
  completed_at timestamptz not null,
  signal_count integer not null default 0 check (signal_count between 0 and 500),
  error_code text,
  error_message text,
  created_at timestamptz not null default now(),
  check (completed_at >= started_at)
);

create table if not exists public.trend_signals (
  id uuid primary key default gen_random_uuid(),
  platform text not null check (platform in ('xiaohongshu', 'douyin', 'xiaoheihe')),
  external_id text not null check (char_length(btrim(external_id)) between 1 and 200),
  source_url text not null check (char_length(source_url) between 12 and 1000),
  title text not null check (char_length(btrim(title)) between 2 and 500),
  excerpt text,
  tags text[] not null default '{}'::text[],
  query_terms text[] not null default '{}'::text[],
  published_at timestamptz,
  first_collected_at timestamptz not null,
  last_collected_at timestamptz not null,
  latest_metrics jsonb not null default '{}'::jsonb check (jsonb_typeof(latest_metrics) = 'object'),
  latest_run_id uuid references public.trend_collection_runs(id) on delete set null,
  latest_node_id text references public.trend_collector_nodes(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (platform, external_id),
  check (last_collected_at >= first_collected_at)
);

create table if not exists public.trend_signal_snapshots (
  id uuid primary key default gen_random_uuid(),
  signal_id uuid not null references public.trend_signals(id) on delete cascade,
  run_id uuid not null references public.trend_collection_runs(id) on delete cascade,
  node_id text references public.trend_collector_nodes(id) on delete set null,
  query_term text,
  metrics jsonb not null default '{}'::jsonb check (jsonb_typeof(metrics) = 'object'),
  collected_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (signal_id, run_id)
);

create table if not exists public.trend_terms (
  id uuid primary key default gen_random_uuid(),
  normalized_term text not null unique
    check (char_length(normalized_term) between 2 and 80),
  display_term text not null check (char_length(btrim(display_term)) between 2 and 80),
  trend_stage text not null default 'new'
    check (trend_stage in ('new', 'warming', 'hot', 'persistent', 'cooling')),
  review_status text not null default 'pending'
    check (review_status in ('pending', 'tracked', 'dismissed')),
  first_seen_at timestamptz not null,
  last_seen_at timestamptz not null,
  platforms text[] not null default '{}'::text[]
    check (platforms <@ array['xiaohongshu', 'douyin', 'xiaoheihe']::text[]),
  signal_count integer not null default 0 check (signal_count >= 0),
  recent_signal_count integer not null default 0 check (recent_signal_count >= 0),
  previous_signal_count integer not null default 0 check (previous_signal_count >= 0),
  growth_percent numeric(10,2),
  trend_score smallint not null default 0 check (trend_score between 0 and 100),
  confidence_score smallint not null default 0 check (confidence_score between 0 and 100),
  explanation text,
  suggested_keywords text[] not null default '{}'::text[],
  reviewed_by uuid references public.user_profiles(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (last_seen_at >= first_seen_at)
);

create table if not exists public.trend_signal_terms (
  signal_id uuid not null references public.trend_signals(id) on delete cascade,
  term_id uuid not null references public.trend_terms(id) on delete cascade,
  observed_at timestamptz not null,
  primary key (signal_id, term_id)
);

create index if not exists trend_collection_runs_node_date_idx
  on public.trend_collection_runs (node_id, completed_at desc);
create index if not exists trend_collection_runs_platform_date_idx
  on public.trend_collection_runs (platform, completed_at desc);
create index if not exists trend_signals_platform_date_idx
  on public.trend_signals (platform, last_collected_at desc);
create index if not exists trend_signal_snapshots_signal_date_idx
  on public.trend_signal_snapshots (signal_id, collected_at desc);
create index if not exists trend_terms_board_idx
  on public.trend_terms (review_status, trend_stage, trend_score desc, last_seen_at desc);
create index if not exists trend_signal_terms_term_date_idx
  on public.trend_signal_terms (term_id, observed_at desc);

create or replace function public.touch_trend_discovery_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  new.updated_at = now();
  return new;
end
$$;

drop trigger if exists touch_trend_collector_nodes_updated_at on public.trend_collector_nodes;
create trigger touch_trend_collector_nodes_updated_at
before update on public.trend_collector_nodes
for each row execute function public.touch_trend_discovery_updated_at();

drop trigger if exists touch_trend_signals_updated_at on public.trend_signals;
create trigger touch_trend_signals_updated_at
before update on public.trend_signals
for each row execute function public.touch_trend_discovery_updated_at();

drop trigger if exists touch_trend_terms_updated_at on public.trend_terms;
create trigger touch_trend_terms_updated_at
before update on public.trend_terms
for each row execute function public.touch_trend_discovery_updated_at();

-- Recalculate deterministic trend scores after a collector batch. SEO volume
-- and rankings are intentionally excluded: they are later validation signals,
-- not inputs to early social trend detection.
create or replace function public.refresh_trend_discovery_terms()
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_updated integer := 0;
begin
  with stats as (
    select
      link.term_id,
      min(signal.first_collected_at) as first_seen_at,
      max(signal.last_collected_at) as last_seen_at,
      count(distinct signal.id)::integer as signal_count,
      count(distinct signal.id) filter (
        where coalesce(signal.published_at, signal.first_collected_at) >= now() - interval '24 hours'
      )::integer as recent_signal_count,
      count(distinct signal.id) filter (
        where coalesce(signal.published_at, signal.first_collected_at) >= now() - interval '48 hours'
          and coalesce(signal.published_at, signal.first_collected_at) < now() - interval '24 hours'
      )::integer as previous_signal_count,
      array_agg(distinct signal.platform order by signal.platform) as platforms
    from public.trend_signal_terms link
    join public.trend_signals signal on signal.id = link.signal_id
    group by link.term_id
  ), scored as (
    select
      stats.*,
      case
        when stats.previous_signal_count = 0 and stats.recent_signal_count > 0 then 100::numeric
        when stats.previous_signal_count = 0 then null
        else round(
          ((stats.recent_signal_count - stats.previous_signal_count)::numeric
            / stats.previous_signal_count::numeric) * 100,
          2
        )
      end as growth_percent,
      least(100, greatest(0,
        case
          when stats.first_seen_at >= now() - interval '24 hours' then 20
          when stats.first_seen_at >= now() - interval '3 days' then 12
          when stats.first_seen_at >= now() - interval '7 days' then 6
          else 0
        end
        + case cardinality(stats.platforms)
          when 3 then 30
          when 2 then 22
          else 8
        end
        + case
          when stats.previous_signal_count = 0 and stats.recent_signal_count >= 5 then 25
          when stats.previous_signal_count = 0 and stats.recent_signal_count >= 2 then 18
          when stats.previous_signal_count = 0 and stats.recent_signal_count = 1 then 8
          when stats.recent_signal_count > stats.previous_signal_count
            then least(25, 8 + (stats.recent_signal_count - stats.previous_signal_count) * 4)
          else 0
        end
        + least(15, stats.signal_count * 3)
        + case
          when stats.last_seen_at - stats.first_seen_at >= interval '7 days' then 10
          when stats.last_seen_at - stats.first_seen_at >= interval '3 days' then 6
          else 0
        end
      ))::smallint as trend_score,
      least(100, stats.signal_count * 8 + cardinality(stats.platforms) * 15)::smallint as confidence_score
    from stats
  ), staged as (
    select
      scored.*,
      case
        when scored.trend_score >= 70 and scored.recent_signal_count >= 3 then 'hot'
        when scored.trend_score >= 45 and scored.recent_signal_count > scored.previous_signal_count then 'warming'
        when scored.first_seen_at >= now() - interval '24 hours' then 'new'
        when scored.last_seen_at - scored.first_seen_at >= interval '3 days'
          and scored.last_seen_at >= now() - interval '48 hours' then 'persistent'
        else 'cooling'
      end as trend_stage
    from scored
  )
  update public.trend_terms term
  set
    first_seen_at = staged.first_seen_at,
    last_seen_at = staged.last_seen_at,
    platforms = staged.platforms,
    signal_count = staged.signal_count,
    recent_signal_count = staged.recent_signal_count,
    previous_signal_count = staged.previous_signal_count,
    growth_percent = staged.growth_percent,
    trend_score = staged.trend_score,
    confidence_score = staged.confidence_score,
    trend_stage = staged.trend_stage
  from staged
  where term.id = staged.term_id;

  get diagnostics v_updated = row_count;
  return v_updated;
end
$$;

-- Keep raw collection evidence bounded. Candidate terms explicitly marked as
-- tracked remain available even after their old source cards expire.
create or replace function public.cleanup_trend_discovery_data()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_snapshots integer := 0;
  v_runs integer := 0;
  v_signals integer := 0;
  v_terms integer := 0;
  v_refreshed integer := 0;
begin
  delete from public.trend_signal_snapshots
  where collected_at < now() - interval '30 days';
  get diagnostics v_snapshots = row_count;

  delete from public.trend_collection_runs
  where completed_at < now() - interval '30 days';
  get diagnostics v_runs = row_count;

  delete from public.trend_signals
  where last_collected_at < now() - interval '90 days';
  get diagnostics v_signals = row_count;

  update public.trend_terms term
  set
    trend_stage = 'cooling',
    platforms = '{}'::text[],
    signal_count = 0,
    recent_signal_count = 0,
    previous_signal_count = 0,
    growth_percent = null,
    trend_score = 0,
    confidence_score = 0
  where term.review_status = 'tracked'
    and not exists (
      select 1
      from public.trend_signal_terms link
      where link.term_id = term.id
    );

  delete from public.trend_terms term
  where term.review_status <> 'tracked'
    and not exists (
      select 1
      from public.trend_signal_terms link
      where link.term_id = term.id
    );
  get diagnostics v_terms = row_count;

  v_refreshed := public.refresh_trend_discovery_terms();
  return jsonb_build_object(
    'snapshots', v_snapshots,
    'runs', v_runs,
    'signals', v_signals,
    'terms', v_terms,
    'refreshed', v_refreshed
  );
end
$$;

alter table public.trend_collector_nodes enable row level security;
alter table public.trend_collection_runs enable row level security;
alter table public.trend_signals enable row level security;
alter table public.trend_signal_snapshots enable row level security;
alter table public.trend_terms enable row level security;
alter table public.trend_signal_terms enable row level security;

revoke all on table public.trend_collector_nodes from public, anon, authenticated;
revoke all on table public.trend_collection_runs from public, anon, authenticated;
revoke all on table public.trend_signals from public, anon, authenticated;
revoke all on table public.trend_signal_snapshots from public, anon, authenticated;
revoke all on table public.trend_terms from public, anon, authenticated;
revoke all on table public.trend_signal_terms from public, anon, authenticated;
grant all on table public.trend_collector_nodes to service_role;
grant all on table public.trend_collection_runs to service_role;
grant all on table public.trend_signals to service_role;
grant all on table public.trend_signal_snapshots to service_role;
grant all on table public.trend_terms to service_role;
grant all on table public.trend_signal_terms to service_role;

revoke all on function public.touch_trend_discovery_updated_at() from public;
revoke all on function public.refresh_trend_discovery_terms() from public;
revoke all on function public.cleanup_trend_discovery_data() from public;
grant execute on function public.refresh_trend_discovery_terms() to service_role;
grant execute on function public.cleanup_trend_discovery_data() to service_role;

commit;
