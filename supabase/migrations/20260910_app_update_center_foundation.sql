-- v4.0.0 experimental application update center.
-- All tables are private to the service role; the application layer grants
-- access only to active super administrators.
begin;

create table if not exists public.app_update_apps (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 2 and 120),
  platform text not null check (platform in ('android', 'ios', 'windows', 'macos', 'web', 'other')),
  package_identifier text check (package_identifier is null or char_length(btrim(package_identifier)) between 2 and 255),
  status text not null default 'active' check (status in ('active', 'paused', 'archived')),
  latest_approved_version text,
  latest_approved_at timestamptz,
  created_by uuid references public.user_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.app_update_sources (
  id uuid primary key default gen_random_uuid(),
  app_id uuid not null references public.app_update_apps(id) on delete cascade,
  source_name text not null check (char_length(btrim(source_name)) between 2 and 120),
  source_type text not null default 'official'
    check (source_type in ('official', 'app_store', 'download_site', 'other')),
  source_url text not null check (char_length(source_url) between 12 and 1200),
  extractor_config jsonb not null default '{}'::jsonb check (jsonb_typeof(extractor_config) = 'object'),
  enabled boolean not null default true,
  last_status text not null default 'idle'
    check (last_status in ('idle', 'success', 'no_change', 'error')),
  last_checked_at timestamptz,
  last_success_at timestamptz,
  last_error text,
  consecutive_failures integer not null default 0 check (consecutive_failures >= 0),
  created_by uuid references public.user_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (app_id, source_url)
);

create table if not exists public.app_update_releases (
  id uuid primary key default gen_random_uuid(),
  app_id uuid not null references public.app_update_apps(id) on delete cascade,
  source_id uuid not null references public.app_update_sources(id) on delete cascade,
  version text not null check (char_length(btrim(version)) between 1 and 100),
  normalized_version text not null check (char_length(normalized_version) between 1 and 100),
  changelog text not null default '' check (char_length(changelog) <= 30000),
  release_date date,
  package_size text check (package_size is null or char_length(package_size) <= 100),
  download_url text check (download_url is null or char_length(download_url) between 12 and 2000),
  source_url text not null check (char_length(source_url) between 12 and 1200),
  review_status text not null default 'pending'
    check (review_status in ('pending', 'approved', 'rejected')),
  extraction_confidence smallint not null default 0 check (extraction_confidence between 0 and 100),
  discovered_at timestamptz not null default now(),
  last_collected_at timestamptz not null default now(),
  reviewed_by uuid references public.user_profiles(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_id, normalized_version)
);

create table if not exists public.app_update_crawl_runs (
  id uuid primary key default gen_random_uuid(),
  app_id uuid not null references public.app_update_apps(id) on delete cascade,
  source_id uuid not null references public.app_update_sources(id) on delete cascade,
  status text not null check (status in ('running', 'completed', 'no_change', 'failed')),
  discovered_version text,
  error_message text,
  action_run_id text,
  started_at timestamptz not null,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  check (completed_at is null or completed_at >= started_at)
);

create index if not exists app_update_apps_status_idx
  on public.app_update_apps (status, updated_at desc);
create index if not exists app_update_sources_crawl_idx
  on public.app_update_sources (enabled, last_checked_at nulls first);
create index if not exists app_update_releases_review_idx
  on public.app_update_releases (review_status, discovered_at desc);
create index if not exists app_update_releases_app_idx
  on public.app_update_releases (app_id, discovered_at desc);
create index if not exists app_update_crawl_runs_date_idx
  on public.app_update_crawl_runs (started_at desc);

create or replace function public.touch_app_update_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  new.updated_at = now();
  return new;
end
$$;

drop trigger if exists touch_app_update_apps_updated_at on public.app_update_apps;
create trigger touch_app_update_apps_updated_at
before update on public.app_update_apps
for each row execute function public.touch_app_update_updated_at();

drop trigger if exists touch_app_update_sources_updated_at on public.app_update_sources;
create trigger touch_app_update_sources_updated_at
before update on public.app_update_sources
for each row execute function public.touch_app_update_updated_at();

drop trigger if exists touch_app_update_releases_updated_at on public.app_update_releases;
create trigger touch_app_update_releases_updated_at
before update on public.app_update_releases
for each row execute function public.touch_app_update_updated_at();

create or replace function public.create_app_update_target(
  p_name text,
  p_platform text,
  p_package_identifier text,
  p_source_name text,
  p_source_type text,
  p_source_url text,
  p_actor uuid
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_app_id uuid;
begin
  insert into public.app_update_apps (name, platform, package_identifier, created_by)
  values (btrim(p_name), p_platform, nullif(btrim(p_package_identifier), ''), p_actor)
  returning id into v_app_id;

  insert into public.app_update_sources (
    app_id, source_name, source_type, source_url, created_by
  ) values (
    v_app_id, btrim(p_source_name), p_source_type, p_source_url, p_actor
  );
  return v_app_id;
end
$$;

create or replace function public.review_app_update_release(
  p_release_id uuid,
  p_review_status text,
  p_reviewer uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_app_id uuid;
begin
  if p_review_status not in ('approved', 'rejected') then
    raise exception using errcode = '22023', message = 'invalid review status';
  end if;

  update public.app_update_releases
  set review_status = p_review_status, reviewed_by = p_reviewer, reviewed_at = now()
  where id = p_release_id
  returning app_id into v_app_id;
  if v_app_id is null then
    raise exception using errcode = 'P0002', message = 'release not found';
  end if;

  update public.app_update_apps app
  set
    latest_approved_version = latest.version,
    latest_approved_at = latest.reviewed_at
  from (
    select release.version, release.reviewed_at
    from public.app_update_releases release
    where release.app_id = v_app_id and release.review_status = 'approved'
    order by coalesce(release.release_date::timestamptz, release.discovered_at) desc,
      release.discovered_at desc, release.id desc
    limit 1
  ) latest
  where app.id = v_app_id;

  if not exists (
    select 1 from public.app_update_releases
    where app_id = v_app_id and review_status = 'approved'
  ) then
    update public.app_update_apps
    set latest_approved_version = null, latest_approved_at = null
    where id = v_app_id;
  end if;
end
$$;

alter table public.app_update_apps enable row level security;
alter table public.app_update_sources enable row level security;
alter table public.app_update_releases enable row level security;
alter table public.app_update_crawl_runs enable row level security;

revoke all on table public.app_update_apps from public, anon, authenticated;
revoke all on table public.app_update_sources from public, anon, authenticated;
revoke all on table public.app_update_releases from public, anon, authenticated;
revoke all on table public.app_update_crawl_runs from public, anon, authenticated;
grant all on table public.app_update_apps to service_role;
grant all on table public.app_update_sources to service_role;
grant all on table public.app_update_releases to service_role;
grant all on table public.app_update_crawl_runs to service_role;

revoke all on function public.touch_app_update_updated_at() from public;
revoke all on function public.create_app_update_target(text, text, text, text, text, text, uuid) from public;
revoke all on function public.review_app_update_release(uuid, text, uuid) from public;
grant execute on function public.create_app_update_target(text, text, text, text, text, text, uuid) to service_role;
grant execute on function public.review_app_update_release(uuid, text, uuid) to service_role;

commit;
