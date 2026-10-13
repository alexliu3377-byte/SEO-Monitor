-- A source stage can finish after the nominal last (index) cron event. The
-- last actual source completion claims one date/version-specific derivation.
create table if not exists public.crawl_derivation_runs (
  data_date date primary key,
  source_version text not null,
  run_id text not null,
  state text not null check (state in ('running', 'done', 'failed')),
  started_at timestamptz not null default now(),
  finished_at timestamptz
);
alter table public.crawl_derivation_runs enable row level security;
revoke all on public.crawl_derivation_runs from anon, authenticated;
grant all on public.crawl_derivation_runs to service_role;

create or replace function public.claim_crawl_derivation(p_date date, p_run_id text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  missing text[];
  version text;
  claimed integer;
begin
  if p_date is null or nullif(p_run_id, '') is null then raise exception 'Missing derivation scope'; end if;
  perform pg_advisory_xact_lock(hashtextextended('crawl-derivation:' || p_date::text, 0));
  select array_agg(required.step order by required.step) into missing
  from unnest(array['keywords','weight','rank','rank-title','index-pages']) required(step)
  where not exists (select 1 from public.crawl_step_completion completed
    where completed.data_date = p_date and completed.step = required.step and completed.processing_complete);
  if cardinality(missing) > 0 then
    return jsonb_build_object('ready', false, 'claimed', false, 'missing', to_jsonb(missing));
  end if;
  select md5(string_agg(step || ':' || run_id || ':' || completed_at::text, '|' order by step)) into version
  from public.crawl_step_completion where data_date = p_date
    and step in ('keywords','weight','rank','rank-title','index-pages');
  insert into public.crawl_derivation_runs(data_date, source_version, run_id, state, started_at, finished_at)
    values (p_date, version, p_run_id, 'running', now(), null)
  on conflict (data_date) do update set
    source_version = excluded.source_version, run_id = excluded.run_id,
    state = 'running', started_at = now(), finished_at = null
  where (crawl_derivation_runs.state <> 'running' or crawl_derivation_runs.started_at < now() - interval '6 hours')
    and (crawl_derivation_runs.source_version <> excluded.source_version or crawl_derivation_runs.state <> 'done');
  get diagnostics claimed = row_count;
  return jsonb_build_object('ready', true, 'claimed', claimed = 1, 'sourceVersion', version, 'missing', '[]'::jsonb);
end;
$$;

create or replace function public.finish_crawl_derivation(p_date date, p_run_id text, p_success boolean)
returns boolean language plpgsql security definer set search_path = public as $$
declare changed integer;
begin
  update public.crawl_derivation_runs set state = case when p_success then 'done' else 'failed' end,
    finished_at = now()
  where data_date = p_date and run_id = p_run_id and state = 'running';
  get diagnostics changed = row_count;
  return changed = 1;
end;
$$;
revoke all on function public.claim_crawl_derivation(date, text) from public, anon, authenticated;
revoke all on function public.finish_crawl_derivation(date, text, boolean) from public, anon, authenticated;
grant execute on function public.claim_crawl_derivation(date, text) to service_role;
grant execute on function public.finish_crawl_derivation(date, text, boolean) to service_role;
