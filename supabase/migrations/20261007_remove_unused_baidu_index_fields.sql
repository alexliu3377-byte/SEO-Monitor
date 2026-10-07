-- The collection monitor only retains Baidu collection and Baidu index.
begin;

alter table public.index_snapshots
  drop column if exists baidu_home_position,
  drop column if exists baidu_new_1d,
  drop column if exists baidu_new_7d,
  drop column if exists baidu_new_30d;

commit;
