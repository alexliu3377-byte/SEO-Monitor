-- Page the application-update list in Postgres instead of transferring every
-- release to the application server. Run before deploying the matching API.
begin;

create or replace function public.get_app_update_releases_page(
  p_search text default '',
  p_review_status text default '',
  p_source_type text default '',
  p_offset integer default 0,
  p_limit integer default 25
)
returns jsonb
language sql
stable
security invoker
set search_path = pg_catalog, public
as $$
  with latest_per_app as (
    select distinct on (release.app_id)
      release.id, release.app_id, release.source_id, release.version,
      release.changelog, release.release_date, release.package_size,
      release.download_url, release.source_url, release.review_status,
      release.extraction_confidence, release.discovered_at,
      app.name as app_name, app.platform as app_platform,
      source.source_name, source.source_type
    from public.app_update_releases release
    join public.app_update_apps app on app.id = release.app_id
    join public.app_update_sources source on source.id = release.source_id
    where (coalesce(p_search, '') = '' or app.name ilike '%' || p_search || '%')
      and (coalesce(p_review_status, '') = '' or release.review_status = p_review_status)
      and (coalesce(p_source_type, '') = '' or source.source_type = p_source_type)
    order by release.app_id,
      coalesce(release.release_date::timestamp at time zone 'UTC', release.discovered_at) desc,
      release.discovered_at desc, release.id desc
  ), page_rows as (
    select * from latest_per_app
    order by coalesce(release_date::timestamp at time zone 'UTC', discovered_at) desc,
      discovered_at desc, id desc
    offset greatest(coalesce(p_offset, 0), 0)
    limit least(greatest(coalesce(p_limit, 25), 1), 50)
  )
  select pg_catalog.jsonb_build_object(
    'items', coalesce((
      select pg_catalog.jsonb_agg(to_jsonb(page_rows) order by
        coalesce(release_date::timestamp at time zone 'UTC', discovered_at) desc,
        discovered_at desc, id desc)
      from page_rows
    ), '[]'::jsonb),
    'total', (select count(*) from latest_per_app)
  )
$$;

revoke all on function public.get_app_update_releases_page(text, text, text, integer, integer) from public, anon, authenticated;
grant execute on function public.get_app_update_releases_page(text, text, text, integer, integer) to service_role;

commit;
