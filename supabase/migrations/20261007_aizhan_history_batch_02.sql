-- Backfill the second Aizhan history-summary batch supplied on 2026-10-07.
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
  ('yxol.net',        0, 0, '2026-10-05'::date, 0, '2026-09-26'::date, 0, 0, '2026-09-19'::date, 0, '2026-09-18'::date),
  ('jysedu.com',      0, 4, '2024-03-03'::date, 0, '2024-12-29'::date, 0, 6, '2024-03-21'::date, 0, '2024-09-12'::date),
  ('miniyxw.com',     0, 2, '2022-08-07'::date, 0, '2022-01-05'::date, 0, 4, '2022-07-01'::date, 0, '2022-10-25'::date),
  ('kuaixiazai.com',  0, 7, '2016-06-30'::date, 0, '2016-06-15'::date, 0, 7, '2016-07-02'::date, 0, '2018-07-21'::date),
  ('byshr.com',       0, 2, '2016-10-04'::date, 0, '2025-12-29'::date, 0, 1, '2021-08-02'::date, 0, '2024-06-02'::date),
  ('lzrs.com',        0, 1, '2016-12-22'::date, 0, '2026-08-14'::date, 0, 1, '2017-02-20'::date, 0, '2026-08-14'::date),
  ('pejdw.com',       2, 2, '2026-10-01'::date, 2, '2026-09-24'::date, 2, 3, '2026-10-01'::date, 2, '2026-10-04'::date),
  ('onlinedown.net',  7, 7, '2026-09-29'::date, 7, '2026-09-15'::date, 7, 7, '2026-09-15'::date, 7, '2026-09-17'::date),
  ('ddooo.com',       7, 7, '2026-09-18'::date, 6, '2026-10-04'::date, 7, 7, '2026-09-18'::date, 7, '2026-10-04'::date),
  ('downza.cn',       7, 7, '2026-10-07'::date, 6, '2026-09-26'::date, 7, 7, '2026-09-16'::date, 6, '2026-09-15'::date)
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
