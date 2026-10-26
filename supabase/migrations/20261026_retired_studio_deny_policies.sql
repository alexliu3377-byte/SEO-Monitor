begin;
-- Data already purged and feature retired: do not retain per-row identity
-- checks or reopen browser reads/writes on these three empty legacy tables.
alter policy page_studio_projects_owner_access on public.page_studio_projects
  using (false) with check (false);
alter policy page_studio_favorites_owner_access on public.page_studio_favorite_modules
  using (false) with check (false);
alter policy page_studio_versions_owner_access on public.page_studio_project_versions
  using (false) with check (false);
commit;
