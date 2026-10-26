-- Guard every pair before changing anything. Fail quickly if a busy relation
-- cannot be locked; never wait on a production crawl or use CASCADE.
begin;
set local lock_timeout = '1s';
set local statement_timeout = '15s';
do $$
declare pair record; candidate record; retained record;
begin
  for pair in select * from (values
    ('site_keyword_ranks_date', 'idx_site_keyword_ranks_stat_date'),
    ('task_group_members_group_user_unique', 'task_group_members_pkey'),
    ('user_site_access_user_site_unique', 'user_site_access_pkey')
  ) as pairs(remove_name, keep_name)
  loop
    select * into candidate from pg_index where indexrelid = to_regclass('public.' || pair.remove_name);
    if not found then continue; end if;
    select * into retained from pg_index where indexrelid = to_regclass('public.' || pair.keep_name);
    if not found then raise exception 'Retained index missing: %', pair.keep_name; end if;
    if candidate.indisprimary or exists (select 1 from pg_constraint where conindid = candidate.indexrelid)
      or not retained.indisvalid or not retained.indisready
      or candidate.indrelid <> retained.indrelid
      or candidate.indisunique <> retained.indisunique
      or candidate.indkey <> retained.indkey or candidate.indclass <> retained.indclass
      or candidate.indcollation <> retained.indcollation or candidate.indoption <> retained.indoption
      or candidate.indpred::text is distinct from retained.indpred::text
      or candidate.indexprs::text is distinct from retained.indexprs::text then
      raise exception 'Index pair is not safe to deduplicate: %, %', pair.remove_name, pair.keep_name;
    end if;
  end loop;
end;
$$;

drop index if exists public.site_keyword_ranks_date;
drop index if exists public.task_group_members_group_user_unique;
drop index if exists public.user_site_access_user_site_unique;
commit;
