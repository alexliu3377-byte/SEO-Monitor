-- Backfill the second completed Aizhan Baidu collection/index task batch.
-- Only collection and index are retained; zero is an explicit API value.
begin;

insert into public.index_snapshots (
  site_id,
  snapshot_date,
  index_count,
  baidu_index_count
)
select
  s.id,
  '2026-10-07'::date,
  v.baidu_collection,
  v.baidu_index
from public.sites s
join (values
  ('333ttt.com', 5500000, 0),
  ('51pgzs.com', 3750000, 0),
  ('52xz.com',    102969,  0),
  ('5577.com',    7800000, 0),
  ('6822.com',    397407,  0),
  ('6ll.com',     975000,  0),
  ('700g.com',    47611,   0),
  ('70wn.com',    73,      0),
  ('7xz.com',     244730,  0),
  ('87g.com',     8920000, 0)
) as v(domain, baidu_collection, baidu_index) on s.domain = v.domain
on conflict (site_id, snapshot_date) do update set
  index_count = excluded.index_count,
  baidu_index_count = excluded.baidu_index_count;

commit;
