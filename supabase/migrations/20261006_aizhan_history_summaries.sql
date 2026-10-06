-- Store the compact history summary returned by Aizhan's hisinfos endpoint.
-- Keyword counts are deliberately kept separate from Baidu index snapshots:
-- pc_sum/m_sum and *_nums_* describe ranked keyword counts, not indexed pages.
begin;

create table if not exists public.site_aizhan_history_summaries (
  site_id uuid primary key references public.sites(id) on delete cascade,
  pc_current_weight integer not null default 0,
  pc_current_keywords integer not null default 0,
  pc_max_weight integer not null default 0,
  pc_max_keywords integer not null default 0,
  pc_max_date date,
  pc_min_weight integer not null default 0,
  pc_min_keywords integer not null default 0,
  pc_min_date date,
  mobile_current_weight integer not null default 0,
  mobile_current_keywords integer not null default 0,
  mobile_max_weight integer not null default 0,
  mobile_max_keywords integer not null default 0,
  mobile_max_date date,
  mobile_min_weight integer not null default 0,
  mobile_min_keywords integer not null default 0,
  mobile_min_date date,
  source_checked_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.site_aizhan_history_summaries enable row level security;
revoke all on table public.site_aizhan_history_summaries from public, anon, authenticated;
grant all on table public.site_aizhan_history_summaries to service_role;

insert into public.site_aizhan_history_summaries (
  site_id,
  pc_current_weight, pc_current_keywords, pc_max_weight, pc_max_keywords, pc_max_date, pc_min_weight, pc_min_keywords, pc_min_date,
  mobile_current_weight, mobile_current_keywords, mobile_max_weight, mobile_max_keywords, mobile_max_date, mobile_min_weight, mobile_min_keywords, mobile_min_date,
  source_checked_at
)
select
  s.id,
  v.pc_current_weight, v.pc_current_keywords, v.pc_max_weight, v.pc_max_keywords, v.pc_max_date, v.pc_min_weight, v.pc_min_keywords, v.pc_min_date,
  v.mobile_current_weight, v.mobile_current_keywords, v.mobile_max_weight, v.mobile_max_keywords, v.mobile_max_date, v.mobile_min_weight, v.mobile_min_keywords, v.mobile_min_date,
  '2026-10-06 00:00:00+08'::timestamptz
from public.sites s
join (values
  ('youxiniao.com', 6, 24765, 6, 26689, '2026-09-17'::date, 5, 25425, '2026-09-24'::date, 6, 20437, 6, 26689, '2026-09-17'::date, 6, 20459, '2026-10-05'::date),
  ('sjwyx.com',      5,  7813, 5,  7880, '2026-09-20'::date, 4,  7703, '2026-10-01'::date, 5,  6297, 5,  6725, '2026-09-17'::date, 4,  8121, '2026-09-16'::date),
  ('f71.com',        3,  1868, 3,  1980, '2026-09-15'::date, 3,  1780, '2026-09-29'::date, 4,  1841, 4,  1898, '2026-09-16'::date, 3,  1980, '2026-09-15'::date),
  ('nycr.org.cn',    4,  4622, 4,  4700, '2026-10-01'::date, 4,  4199, '2026-09-24'::date, 4,  3558, 4,  4528, '2026-09-16'::date, 4,  3482, '2026-09-24'::date),
  ('qtvcd.com',      0,     0, 6, 11324, '2023-06-24'::date, 0,     0, '2025-11-27'::date, 0,     1, 8, 10791, '2023-07-29'::date, 0,     0, '2024-09-20'::date),
  ('mopxz.com',      1,   202, 1,   184, '2026-09-16'::date, 1,   142, '2026-09-24'::date, 1,   201, 2,   199, '2026-09-19'::date, 1,   168, '2026-09-23'::date),
  ('blrc.com.cn',    1,   101, 1,   114, '2026-09-15'::date, 1,    93, '2026-09-26'::date, 1,   148, 1,   175, '2026-09-21'::date, 1,   114, '2026-09-15'::date),
  ('staples.cn',     0,     9, 1,    11, '2026-09-15'::date, 0,    11, '2026-09-16'::date, 1,    19, 1,    21, '2026-10-04'::date, 1,     8, '2026-09-16'::date),
  ('jnvc.cn',        0,    26, 1,    27, '2026-09-17'::date, 0,    19, '2026-09-21'::date, 0,    23, 1,    26, '2026-09-16'::date, 0,    18, '2026-09-22'::date),
  ('115wg.com',      0,    30, 0,    38, '2026-09-15'::date, 0,    22, '2026-10-03'::date, 0,    33, 0,    41, '2026-09-27'::date, 0,    12, '2026-09-20'::date)
) as v(
  domain,
  pc_current_weight, pc_current_keywords, pc_max_weight, pc_max_keywords, pc_max_date, pc_min_weight, pc_min_keywords, pc_min_date,
  mobile_current_weight, mobile_current_keywords, mobile_max_weight, mobile_max_keywords, mobile_max_date, mobile_min_weight, mobile_min_keywords, mobile_min_date
) on s.domain = v.domain
on conflict (site_id) do update set
  pc_current_weight = excluded.pc_current_weight,
  pc_current_keywords = excluded.pc_current_keywords,
  pc_max_weight = excluded.pc_max_weight,
  pc_max_keywords = excluded.pc_max_keywords,
  pc_max_date = excluded.pc_max_date,
  pc_min_weight = excluded.pc_min_weight,
  pc_min_keywords = excluded.pc_min_keywords,
  pc_min_date = excluded.pc_min_date,
  mobile_current_weight = excluded.mobile_current_weight,
  mobile_current_keywords = excluded.mobile_current_keywords,
  mobile_max_weight = excluded.mobile_max_weight,
  mobile_max_keywords = excluded.mobile_max_keywords,
  mobile_max_date = excluded.mobile_max_date,
  mobile_min_weight = excluded.mobile_min_weight,
  mobile_min_keywords = excluded.mobile_min_keywords,
  mobile_min_date = excluded.mobile_min_date,
  source_checked_at = excluded.source_checked_at,
  updated_at = now();

commit;
