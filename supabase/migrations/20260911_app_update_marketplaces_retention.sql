-- Add public marketplace sources and keep only the five newest releases for
-- each application, regardless of which importer or crawler writes them.
begin;

alter table public.app_update_sources
  drop constraint if exists app_update_sources_source_type_check;
alter table public.app_update_sources
  add constraint app_update_sources_source_type_check
  check (source_type in ('official', 'app_store', 'google_play', 'taptap', 'download_site', 'other'));

with ranked as (
  select id, row_number() over (
    partition by app_id
    order by coalesce(release_date::timestamptz, discovered_at) desc,
      discovered_at desc, id desc
  ) as ordinal
  from public.app_update_releases
)
delete from public.app_update_releases release
using ranked
where release.id = ranked.id and ranked.ordinal > 5;

update public.app_update_apps app
set
  (latest_approved_version, latest_approved_at) = (
  select release.version, release.reviewed_at
  from public.app_update_releases release
  where release.app_id = app.id and release.review_status = 'approved'
  order by coalesce(release.release_date::timestamptz, release.discovered_at) desc,
    release.discovered_at desc, release.id desc
  limit 1
  );

create or replace function public.keep_five_app_update_releases()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  delete from public.app_update_releases release
  where release.id in (
    select old_release.id
    from public.app_update_releases old_release
    where old_release.app_id = new.app_id
    order by coalesce(old_release.release_date::timestamptz, old_release.discovered_at) desc,
      old_release.discovered_at desc, old_release.id desc
    offset 5
  );
  update public.app_update_apps app
  set
    (latest_approved_version, latest_approved_at) = (
    select release.version, release.reviewed_at
    from public.app_update_releases release
    where release.app_id = new.app_id and release.review_status = 'approved'
    order by coalesce(release.release_date::timestamptz, release.discovered_at) desc,
      release.discovered_at desc, release.id desc
    limit 1
    )
  where app.id = new.app_id;
  return null;
end
$$;

drop trigger if exists retain_five_app_update_releases on public.app_update_releases;
create trigger retain_five_app_update_releases
after insert or update of release_date on public.app_update_releases
for each row execute function public.keep_five_app_update_releases();

revoke all on function public.keep_five_app_update_releases() from public;

commit;
