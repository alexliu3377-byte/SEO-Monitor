-- Backfill the fifth Aizhan history-summary batch supplied on 2026-10-07.
-- Ranked-keyword counts from hisinfos are intentionally not stored.
begin;

insert into public.site_aizhan_history_summaries (
  site_id,
  pc_current_weight,
  pc_max_weight,
  pc_max_date,
  pc_min_weight,
  pc_min_date,
  mobile_current_weight,
  mobile_max_weight,
  mobile_max_date,
  mobile_min_weight,
  mobile_min_date,
  source_checked_at
)
select
  s.id,
  v.pc_current_weight,
  v.pc_max_weight,
  v.pc_max_date,
  v.pc_min_weight,
  v.pc_min_date,
  v.mobile_current_weight,
  v.mobile_max_weight,
  v.mobile_max_date,
  v.mobile_min_weight,
  v.mobile_min_date,
  '2026-10-07 00:00:00+08'::timestamptz
from public.sites s
join (values
  ('qt6.com',      4, 4, '2026-09-15'::date, 4, '2026-10-01'::date, 5, 5, '2026-09-17'::date, 4, '2026-09-15'::date),
  ('kkx.net',      6, 6, '2026-09-15'::date, 6, '2026-09-29'::date, 6, 6, '2026-09-15'::date, 6, '2026-10-02'::date),
  ('3h3.com',      6, 6, '2026-09-22'::date, 5, '2026-10-03'::date, 6, 6, '2026-09-19'::date, 6, '2026-10-03'::date),
  ('gamehome.tv',  5, 6, '2026-10-05'::date, 5, '2026-09-25'::date, 5, 6, '2026-09-19'::date, 5, '2026-09-22'::date),
  ('hncj.com',     5, 5, '2026-09-17'::date, 5, '2026-10-05'::date, 6, 6, '2026-09-17'::date, 5, '2026-09-16'::date),
  ('whflfa.com',   4, 4, '2026-10-05'::date, 3, '2026-09-24'::date, 4, 4, '2026-09-20'::date, 3, '2026-09-19'::date),
  ('diyiyou.com',  5, 5, '2026-09-17'::date, 5, '2026-10-06'::date, 6, 6, '2026-09-18'::date, 5, '2026-09-17'::date),
  ('962.net',      6, 6, '2026-09-25'::date, 6, '2026-09-20'::date, 7, 7, '2026-09-25'::date, 6, '2026-09-16'::date),
  ('333ttt.com',   5, 6, '2026-09-15'::date, 5, '2026-10-04'::date, 6, 6, '2026-09-15'::date, 6, '2026-10-05'::date),
  ('gzgztx.com',   5, 5, '2026-09-15'::date, 5, '2026-10-06'::date, 6, 7, '2026-09-29'::date, 5, '2026-09-15'::date)
) as v(
  domain,
  pc_current_weight, pc_max_weight, pc_max_date, pc_min_weight, pc_min_date,
  mobile_current_weight, mobile_max_weight, mobile_max_date, mobile_min_weight, mobile_min_date
) on s.domain = v.domain
on conflict (site_id) do update set
  pc_current_weight = excluded.pc_current_weight,
  pc_max_weight = greatest(public.site_aizhan_history_summaries.pc_max_weight, excluded.pc_max_weight),
  pc_max_date = case
    when excluded.pc_max_weight >= public.site_aizhan_history_summaries.pc_max_weight
      or public.site_aizhan_history_summaries.pc_max_date is null
    then excluded.pc_max_date
    else public.site_aizhan_history_summaries.pc_max_date
  end,
  pc_min_weight = case
    when public.site_aizhan_history_summaries.pc_min_date is null then excluded.pc_min_weight
    else least(public.site_aizhan_history_summaries.pc_min_weight, excluded.pc_min_weight)
  end,
  pc_min_date = case
    when public.site_aizhan_history_summaries.pc_min_date is null
      or excluded.pc_min_weight <= public.site_aizhan_history_summaries.pc_min_weight
    then excluded.pc_min_date
    else public.site_aizhan_history_summaries.pc_min_date
  end,
  mobile_current_weight = excluded.mobile_current_weight,
  mobile_max_weight = greatest(public.site_aizhan_history_summaries.mobile_max_weight, excluded.mobile_max_weight),
  mobile_max_date = case
    when excluded.mobile_max_weight >= public.site_aizhan_history_summaries.mobile_max_weight
      or public.site_aizhan_history_summaries.mobile_max_date is null
    then excluded.mobile_max_date
    else public.site_aizhan_history_summaries.mobile_max_date
  end,
  mobile_min_weight = case
    when public.site_aizhan_history_summaries.mobile_min_date is null then excluded.mobile_min_weight
    else least(public.site_aizhan_history_summaries.mobile_min_weight, excluded.mobile_min_weight)
  end,
  mobile_min_date = case
    when public.site_aizhan_history_summaries.mobile_min_date is null
      or excluded.mobile_min_weight <= public.site_aizhan_history_summaries.mobile_min_weight
    then excluded.mobile_min_date
    else public.site_aizhan_history_summaries.mobile_min_date
  end,
  source_checked_at = excluded.source_checked_at,
  updated_at = now();

commit;
