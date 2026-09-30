-- Persist the private Page Studio workspace in Supabase instead of relying on
-- one browser's localStorage. Payloads stay as JSONB because GrapesJS project
-- data is nested and versioned as one document.
begin;

create table if not exists public.page_studio_projects (
  id text primary key check (char_length(id) between 8 and 120),
  owner_id uuid not null default auth.uid() references public.user_profiles(id) on delete cascade,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.page_studio_favorite_modules (
  id text primary key check (char_length(id) between 8 and 120),
  owner_id uuid not null default auth.uid() references public.user_profiles(id) on delete cascade,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.page_studio_project_versions (
  id bigint generated always as identity primary key,
  project_id text not null references public.page_studio_projects(id) on delete cascade,
  owner_id uuid not null default auth.uid() references public.user_profiles(id) on delete cascade,
  version_no integer not null check (version_no > 0),
  label text not null default '手动保存' check (char_length(label) between 1 and 80),
  payload jsonb not null,
  created_at timestamptz not null default now(),
  unique (project_id, version_no)
);

create index if not exists idx_page_studio_projects_owner_updated
  on public.page_studio_projects (owner_id, updated_at desc);
create index if not exists idx_page_studio_favorites_owner_updated
  on public.page_studio_favorite_modules (owner_id, updated_at desc);
create index if not exists idx_page_studio_versions_project_created
  on public.page_studio_project_versions (owner_id, project_id, created_at desc);

alter table public.page_studio_projects enable row level security;
alter table public.page_studio_favorite_modules enable row level security;
alter table public.page_studio_project_versions enable row level security;

drop policy if exists page_studio_projects_owner_access on public.page_studio_projects;
create policy page_studio_projects_owner_access
  on public.page_studio_projects
  for all to authenticated
  using (
    owner_id = auth.uid()
    and auth.uid() = '294f63a9-7c06-455f-9896-0fbc6344cee5'::uuid
  )
  with check (
    owner_id = auth.uid()
    and auth.uid() = '294f63a9-7c06-455f-9896-0fbc6344cee5'::uuid
  );

drop policy if exists page_studio_favorites_owner_access on public.page_studio_favorite_modules;
create policy page_studio_favorites_owner_access
  on public.page_studio_favorite_modules
  for all to authenticated
  using (
    owner_id = auth.uid()
    and auth.uid() = '294f63a9-7c06-455f-9896-0fbc6344cee5'::uuid
  )
  with check (
    owner_id = auth.uid()
    and auth.uid() = '294f63a9-7c06-455f-9896-0fbc6344cee5'::uuid
  );

drop policy if exists page_studio_versions_owner_access on public.page_studio_project_versions;
create policy page_studio_versions_owner_access
  on public.page_studio_project_versions
  for all to authenticated
  using (
    owner_id = auth.uid()
    and auth.uid() = '294f63a9-7c06-455f-9896-0fbc6344cee5'::uuid
  )
  with check (
    owner_id = auth.uid()
    and auth.uid() = '294f63a9-7c06-455f-9896-0fbc6344cee5'::uuid
  );

revoke all on table public.page_studio_projects from public, anon;
revoke all on table public.page_studio_favorite_modules from public, anon;
revoke all on table public.page_studio_project_versions from public, anon;
grant select, insert, update, delete on table public.page_studio_projects to authenticated;
grant select, insert, update, delete on table public.page_studio_favorite_modules to authenticated;
grant select, insert, update, delete on table public.page_studio_project_versions to authenticated;
grant all on table public.page_studio_projects to service_role;
grant all on table public.page_studio_favorite_modules to service_role;
grant all on table public.page_studio_project_versions to service_role;
grant usage, select on sequence public.page_studio_project_versions_id_seq to authenticated, service_role;

commit;
