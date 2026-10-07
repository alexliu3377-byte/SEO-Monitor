-- Backfill the seventh Aizhan history-summary batch supplied on 2026-10-07.
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
  ('9k9k.com',          4, 4, '2026-09-28'::date, 4, '2026-09-23'::date, 5, 5, '2026-09-27'::date, 4, '2026-09-17'::date),
  ('downxing.com',      4, 4, '2026-09-15'::date, 4, '2026-10-02'::date, 5, 5, '2026-09-17'::date, 4, '2026-09-15'::date),
  ('ptxz.com',          4, 4, '2026-10-05'::date, 4, '2026-09-24'::date, 4, 5, '2026-10-01'::date, 4, '2026-09-19'::date),
  ('youxiguancha.com',  3, 4, '2026-09-16'::date, 3, '2026-10-02'::date, 5, 5, '2026-09-17'::date, 4, '2026-09-16'::date),
  ('6ll.com',           3, 4, '2026-09-24'::date, 3, '2026-10-01'::date, 5, 5, '2026-09-21'::date, 3, '2026-09-17'::date),
  ('7xz.com',           4, 4, '2026-09-17'::date, 4, '2026-10-01'::date, 5, 5, '2026-09-18'::date, 4, '2026-09-17'::date),
  ('linuxidc.com',      4, 4, '2026-10-04'::date, 3, '2026-10-01'::date, 4, 5, '2026-09-22'::date, 3, '2026-09-16'::date),
  ('cr173.com',         3, 3, '2026-09-17'::date, 3, '2026-10-06'::date, 4, 5, '2026-09-24'::date, 3, '2026-09-17'::date),
  ('lhdown.com',        4, 4, '2026-10-03'::date, 3, '2026-09-29'::date, 4, 4, '2026-09-23'::date, 3, '2026-09-19'::date),
  ('bk.cooco.net.cn',   3, 3, '2026-10-02'::date, 0, '2026-09-17'::date, 4, 4, '2026-10-03'::date, 0, '2026-09-16'::date)
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
