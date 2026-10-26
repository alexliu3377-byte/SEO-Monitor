-- Page Studio has been retired. The owner explicitly requested deletion of
-- its old projects too. Keep the empty schema/history, not a backup of payloads.
begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

lock table public.page_studio_projects,
  public.page_studio_project_versions,
  public.page_studio_favorite_modules in access exclusive mode;

-- Older deployed tabs import localStorage when the cloud list is empty.
-- Block their mutations so deleted projects cannot silently reappear.
revoke insert, update, delete on table public.page_studio_projects,
  public.page_studio_project_versions,
  public.page_studio_favorite_modules from public, anon, authenticated;

delete from public.page_studio_project_versions;
delete from public.page_studio_favorite_modules;
delete from public.page_studio_projects;

do $$
begin
  if exists (select 1 from public.page_studio_projects)
    or exists (select 1 from public.page_studio_project_versions)
    or exists (select 1 from public.page_studio_favorite_modules) then
    raise exception 'Retired Page Studio data cleanup was incomplete';
  end if;
end;
$$;

commit;
