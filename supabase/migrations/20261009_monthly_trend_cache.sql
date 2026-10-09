-- Monthly trend overview used to issue two exact-count queries for every
-- calendar month on every page view. Keep one compact row per month instead,
-- and populate it from a single grouped query when the cache needs refreshing.

create table if not exists public.monthly_trend_cache (
  month text primary key,
  payload jsonb not null,
  computed_at timestamptz not null default now(),
  is_final boolean not null default true
);

alter table public.monthly_trend_cache
  add column if not exists is_final boolean not null default true;

create table if not exists public.monthly_trend_summary_cache (
  month text primary key check (month ~ '^\d{4}-\d{2}$'),
  app_count bigint not null default 0 check (app_count >= 0),
  game_count bigint not null default 0 check (game_count >= 0),
  computed_at timestamptz not null default now(),
  is_final boolean not null default false
);

alter table public.monthly_trend_summary_cache enable row level security;
revoke all on table public.monthly_trend_summary_cache from anon, authenticated;
grant all on table public.monthly_trend_summary_cache to service_role;

create or replace function public.monthly_keyword_counts(p_start date, p_end date)
returns table(month text, app_count bigint, game_count bigint)
language sql
stable
set search_path = public
as $$
  select
    to_char(date_trunc('month', rk.content_date), 'YYYY-MM') as month,
    count(*) filter (where rk.content_type = 'app')::bigint as app_count,
    count(*) filter (where rk.content_type = 'game')::bigint as game_count
  from public.raw_keywords rk
  where rk.content_date >= p_start
    and rk.content_date <= p_end
  group by date_trunc('month', rk.content_date)
  order by date_trunc('month', rk.content_date);
$$;

revoke all on function public.monthly_keyword_counts(date, date) from public, anon, authenticated;
grant execute on function public.monthly_keyword_counts(date, date) to service_role;
alter function public.monthly_keyword_counts(date, date) set statement_timeout = '60s';
