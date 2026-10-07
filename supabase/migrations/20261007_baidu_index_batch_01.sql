-- Backfill the first completed Aizhan Baidu collection/index task batch.
-- Zero values are explicit API results confirmed by the operator and are
-- therefore stored as real values rather than treated as crawl failures.
begin;

insert into public.index_snapshots (
  site_id,
  snapshot_date,
  index_count,
  baidu_index_count,
  baidu_home_position,
  baidu_new_1d,
  baidu_new_7d,
  baidu_new_30d
)
select
  s.id,
  '2026-10-07'::date,
  v.baidu_collection,
  v.baidu_index,
  v.baidu_home_position,
  v.baidu_new_1d,
  v.baidu_new_7d,
  v.baidu_new_30d
from public.sites s
join (values
  ('115wg.com',   25,      0, 0, 0,    0,      0),
  ('139y.com',    565008,  0, 0, 0,   87, 366000),
  ('1666.com',    4140000, 0, 0, 0,   44, 468000),
  ('18touch.com', 0,       0, 0, 0,    0,      0),
  ('32r.com',     80,      0, 0, 0,   39,     76),
  ('38down.com',  35700,   0, 0, 0,   43,   3970),
  ('3h3.com',     906929,  0, 0, 0,   77, 146000),
  ('52pk.com',    3597217, 0, 0, 0, 2040, 139000)
) as v(
  domain,
  baidu_collection,
  baidu_index,
  baidu_home_position,
  baidu_new_1d,
  baidu_new_7d,
  baidu_new_30d
) on s.domain = v.domain
on conflict (site_id, snapshot_date) do update set
  index_count = excluded.index_count,
  baidu_index_count = excluded.baidu_index_count,
  baidu_home_position = excluded.baidu_home_position,
  baidu_new_1d = excluded.baidu_new_1d,
  baidu_new_7d = excluded.baidu_new_7d,
  baidu_new_30d = excluded.baidu_new_30d;

commit;
