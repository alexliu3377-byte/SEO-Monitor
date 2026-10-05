-- Turn keyword classification into a team layout queue. A keyword can be
-- assigned to more than one task-group site, while problem records remain in
-- the library until a super administrator reviews and deletes them.
alter table public.keyword_volume
  add column if not exists layout_site_domains text[] not null default '{}',
  add column if not exists layout_status text not null default 'unassigned',
  add column if not exists layout_issue_note text,
  add column if not exists layout_updated_by uuid references public.user_profiles(id) on delete set null,
  add column if not exists layout_updated_at timestamptz;

alter table public.keyword_volume
  drop constraint if exists keyword_volume_layout_status_check;

alter table public.keyword_volume
  add constraint keyword_volume_layout_status_check
  check (layout_status in ('unassigned', 'assigned', 'issue'));

create index if not exists idx_keyword_volume_layout_queue
  on public.keyword_volume (layout_status, volume desc, keyword);

create or replace function public.sync_keyword_layout_status()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.layout_site_domains := coalesce(new.layout_site_domains, '{}');
  if new.layout_status <> 'issue' then
    new.layout_status := case
      when cardinality(new.layout_site_domains) > 0 then 'assigned'
      else 'unassigned'
    end;
  end if;
  return new;
end;
$$;

drop trigger if exists sync_keyword_layout_status on public.keyword_volume;
create trigger sync_keyword_layout_status
before insert or update of layout_site_domains, layout_status on public.keyword_volume
for each row execute function public.sync_keyword_layout_status();
