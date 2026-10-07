-- The third-party baidusy field currently returns zero for every queried
-- domain and is not a reliable substitute for verified Baidu index data.
begin;

alter table public.index_snapshots
  drop column if exists baidu_index_count;

commit;
