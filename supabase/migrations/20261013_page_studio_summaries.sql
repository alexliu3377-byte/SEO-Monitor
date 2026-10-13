begin;

-- Project cards need metadata only. Keep each page's HTML/CSS and GrapesJS
-- document in the single-project query, behind the existing owner RLS.
create or replace function public.get_page_studio_project_summaries()
returns setof jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'id', p.id,
    'name', p.payload->>'name',
    'status', p.payload->>'status',
    'createdAt', p.payload->>'createdAt',
    'updatedAt', p.payload->>'updatedAt',
    'activePageId', p.payload->>'activePageId',
    'pages', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', page->>'id', 'name', page->>'name', 'path', page->>'path',
        'targetDevice', page->>'targetDevice'
      ) order by ordinal)
      from jsonb_array_elements(coalesce(p.payload->'pages', '[]'::jsonb)) with ordinality as pages(page, ordinal)
    ), '[]'::jsonb)
  )
  from public.page_studio_projects p
  order by p.updated_at desc, p.id;
$$;

revoke all on function public.get_page_studio_project_summaries() from public, anon;
grant execute on function public.get_page_studio_project_summaries() to authenticated, service_role;

commit;
