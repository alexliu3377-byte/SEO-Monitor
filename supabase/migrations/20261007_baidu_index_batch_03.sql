-- Backfill the third completed Aizhan Baidu collection/index task batch.
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
  ('91danji.com',     2793097, 0),
  ('962.net',         9040000, 0),
  ('9663.com',        3310000, 0),
  ('9k9k.com',        1927143, 0),
  ('anfensi.com',     3360000, 0),
  ('bjgsl.org.cn',    37,      0),
  ('bk.cooco.net.cn', 1624011, 0),
  ('blrc.com.cn',     81900,   0),
  ('btpbc8.com',      67700,   0),
  ('byshr.com',       0,       0)
) as v(domain, baidu_collection, baidu_index) on s.domain = v.domain
on conflict (site_id, snapshot_date) do update set
  index_count = excluded.index_count,
  baidu_index_count = excluded.baidu_index_count;

commit;
