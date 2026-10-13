-- Collect first, then replace each non-empty platform/type in one transaction.
-- A failed insert rolls its delete back; concurrent same-site/day writes lock.
create or replace function public.replace_crawl_rank_rows(
  p_site_id uuid, p_date date, p_target text, p_rows jsonb
) returns integer language plpgsql security definer set search_path = public as $$
declare
  written integer;
begin
  if p_site_id is null or p_date is null or p_target is null or p_target not in ('rank_changes', 'site_keyword_ranks') then raise exception 'Invalid rank target'; end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then raise exception 'Rank rows must be an array'; end if;
  if jsonb_array_length(p_rows) = 0 then return 0; end if;
  if exists (select 1 from jsonb_array_elements(p_rows) row where
      (row->>'site_id')::uuid is distinct from p_site_id or
      (row->>'stat_date')::date is distinct from p_date or
      coalesce(row->>'keyword', '') = '' or
      coalesce(row->>'type', '') not in ('rankup', 'rankdown') or
      (p_target = 'site_keyword_ranks' and coalesce(row->>'platform', '') not in ('mobile', 'pc'))) then
    raise exception 'Invalid rank row scope';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_target || ':' || p_site_id::text || ':' || p_date::text, 0));
  if p_target = 'rank_changes' then
    delete from public.rank_changes existing where existing.site_id = p_site_id and existing.stat_date = p_date
      and existing.type in (select distinct row->>'type' from jsonb_array_elements(p_rows) row);
    insert into public.rank_changes (site_id, stat_date, type, keyword, volume)
      select site_id, stat_date, type, keyword, volume
      from jsonb_populate_recordset(null::public.rank_changes, p_rows);
  else
    delete from public.site_keyword_ranks existing where existing.site_id = p_site_id and existing.stat_date = p_date
      and (existing.platform, existing.type) in
        (select distinct row->>'platform', row->>'type' from jsonb_array_elements(p_rows) row);
    insert into public.site_keyword_ranks (site_id, stat_date, type, platform, keyword, rank_position, prev_rank, volume, title, url)
      select site_id, stat_date, type, platform, keyword, rank_position, prev_rank, volume, title, url
      from jsonb_populate_recordset(null::public.site_keyword_ranks, p_rows);
  end if;
  get diagnostics written = row_count;
  return written;
end;
$$;
revoke all on function public.replace_crawl_rank_rows(uuid, date, text, jsonb) from public, anon, authenticated;
grant execute on function public.replace_crawl_rank_rows(uuid, date, text, jsonb) to service_role;

alter table public.activity_log add column if not exists crawl_run_id text;
alter table public.activity_log add column if not exists data_date date;
alter table public.activity_log add column if not exists completed_at timestamptz;
alter table public.activity_log add column if not exists complete boolean not null default false;
create index if not exists idx_activity_log_crawl_run on public.activity_log(crawl_run_id, step, data_date);

create table if not exists public.crawl_step_completion (
  data_date date not null,
  step text not null,
  run_id text not null,
  processing_complete boolean not null default false,
  complete boolean not null default false,
  unresolved jsonb not null default '[]'::jsonb,
  completed_at timestamptz,
  primary key (data_date, step)
);
alter table public.crawl_step_completion enable row level security;
revoke all on public.crawl_step_completion from anon, authenticated;
grant all on public.crawl_step_completion to service_role;
