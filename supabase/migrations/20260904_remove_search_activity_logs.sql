-- Page searches and export actions are not crawl jobs. Remove their historical
-- noise and prevent older deployed clients from recreating search log rows.
begin;

delete from public.activity_log where type = 'search';

do $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.activity_log'::regclass
      and conname = 'activity_log_type_no_search'
  ) then
    alter table public.activity_log
      add constraint activity_log_type_no_search check (type <> 'search');
  end if;
end
$$;

commit;
