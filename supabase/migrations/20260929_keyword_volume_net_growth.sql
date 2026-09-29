-- Track durable search-volume growth separately from the latest crawl delta.
-- Existing rising rows can honestly start from prev_volume (the only retained
-- older observation). Other rows start from their current value because the
-- overwritten history cannot be reconstructed without inventing a baseline.
begin;

alter table public.keyword_volume
  add column if not exists baseline_volume bigint,
  add column if not exists baseline_date date;

update public.keyword_volume
set
  baseline_volume = coalesce(
    baseline_volume,
    case when prev_volume is not null and volume_change > 0 then prev_volume else volume end
  ),
  baseline_date = coalesce(baseline_date, stat_date, current_date)
where baseline_volume is null
   or baseline_date is null;

alter table public.keyword_volume
  alter column baseline_volume set default 0,
  alter column baseline_volume set not null,
  alter column baseline_date set default current_date,
  alter column baseline_date set not null;

alter table public.keyword_volume
  add column if not exists net_volume_change bigint
  generated always as (volume - baseline_volume) stored;

create index if not exists idx_keyword_volume_net_growth
  on public.keyword_volume (net_volume_change desc, stat_date desc, keyword)
  where net_volume_change > 0;

commit;
