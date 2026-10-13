-- A successfully computed cache can still come from a partially collected
-- daily batch. Keep that source status separate from calculation failures.
alter table public.hot_radar_cache
  add column if not exists source_data_date date,
  add column if not exists source_complete boolean not null default false,
  add column if not exists source_warnings jsonb not null default '[]'::jsonb;
