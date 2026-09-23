-- Count genuinely distinct trend evidence instead of treating different links
-- with identical extracted content as independent mentions.
begin;

alter table public.trend_signals
  add column if not exists evidence_fingerprint text;

create or replace function public.trend_evidence_fingerprint(
  p_title text,
  p_excerpt text
)
returns text
language sql
immutable
set search_path = pg_catalog
as $$
  select md5(lower(regexp_replace(
    btrim(coalesce(p_title, '')) || E'\n' || btrim(coalesce(p_excerpt, '')),
    '[[:space:]]+', ' ', 'g'
  )))
$$;

update public.trend_signals
set evidence_fingerprint = public.trend_evidence_fingerprint(title, excerpt)
where evidence_fingerprint is null
   or evidence_fingerprint !~ '^[0-9a-f]{32}$';

alter table public.trend_signals
  alter column evidence_fingerprint set not null;

alter table public.trend_signals
  drop constraint if exists trend_signals_evidence_fingerprint_check;
alter table public.trend_signals
  add constraint trend_signals_evidence_fingerprint_check
  check (evidence_fingerprint ~ '^[0-9a-f]{32}$');

create index if not exists trend_signals_evidence_idx
  on public.trend_signals (platform, evidence_fingerprint, first_collected_at);

create or replace function public.set_trend_evidence_fingerprint()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  new.evidence_fingerprint := public.trend_evidence_fingerprint(new.title, new.excerpt);
  return new;
end
$$;

drop trigger if exists set_trend_evidence_fingerprint on public.trend_signals;
create trigger set_trend_evidence_fingerprint
before insert or update of title, excerpt on public.trend_signals
for each row execute function public.set_trend_evidence_fingerprint();

revoke all on function public.trend_evidence_fingerprint(text, text) from public, anon, authenticated;
revoke all on function public.set_trend_evidence_fingerprint() from public, anon, authenticated;

create or replace function public.refresh_trend_discovery_terms()
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_updated integer := 0;
begin
  with evidence as (
    select
      link.term_id,
      signal.platform,
      signal.evidence_fingerprint,
      min(coalesce(signal.published_at, signal.first_collected_at)) as evidence_at
    from public.trend_signal_terms link
    join public.trend_signals signal on signal.id = link.signal_id
    group by link.term_id, signal.platform, signal.evidence_fingerprint
  ), stats as (
    select
      evidence.term_id,
      min(evidence.evidence_at) as first_seen_at,
      max(evidence.evidence_at) as last_seen_at,
      count(*)::integer as signal_count,
      count(*) filter (
        where evidence.evidence_at >= now() - interval '24 hours'
      )::integer as recent_signal_count,
      count(*) filter (
        where evidence.evidence_at >= now() - interval '48 hours'
          and evidence.evidence_at < now() - interval '24 hours'
      )::integer as previous_signal_count,
      array_agg(distinct evidence.platform order by evidence.platform) as platforms
    from evidence
    group by evidence.term_id
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

select public.refresh_trend_discovery_terms();

commit;
