-- Keep Baidu collection as the existing index_count metric and add the
-- complementary Aizhan index fields without changing existing reports.
begin;

alter table public.index_snapshots
  add column if not exists baidu_index_count integer,
  add column if not exists baidu_home_position integer,
  add column if not exists baidu_new_1d integer,
  add column if not exists baidu_new_7d integer,
  add column if not exists baidu_new_30d integer;

alter table public.index_snapshots
  drop constraint if exists index_snapshots_baidu_index_count_check,
  drop constraint if exists index_snapshots_baidu_home_position_check,
  drop constraint if exists index_snapshots_baidu_new_1d_check,
  drop constraint if exists index_snapshots_baidu_new_7d_check,
  drop constraint if exists index_snapshots_baidu_new_30d_check;

alter table public.index_snapshots
  add constraint index_snapshots_baidu_index_count_check check (baidu_index_count is null or baidu_index_count >= 0),
  add constraint index_snapshots_baidu_home_position_check check (baidu_home_position is null or baidu_home_position >= 0),
  add constraint index_snapshots_baidu_new_1d_check check (baidu_new_1d is null or baidu_new_1d >= 0),
  add constraint index_snapshots_baidu_new_7d_check check (baidu_new_7d is null or baidu_new_7d >= 0),
  add constraint index_snapshots_baidu_new_30d_check check (baidu_new_30d is null or baidu_new_30d >= 0);

comment on column public.index_snapshots.index_count is 'Baidu collection count (Aizhan baidusl)';
comment on column public.index_snapshots.baidu_index_count is 'Baidu index count (Aizhan baidusy)';
comment on column public.index_snapshots.baidu_home_position is 'Baidu homepage position (Aizhan baidupos)';
comment on column public.index_snapshots.baidu_new_1d is 'Newly collected pages in one day (Aizhan baidu1d)';
comment on column public.index_snapshots.baidu_new_7d is 'Newly collected pages in seven days (Aizhan baidu7d)';
comment on column public.index_snapshots.baidu_new_30d is 'Newly collected pages in thirty days (Aizhan baidu30d)';

commit;
