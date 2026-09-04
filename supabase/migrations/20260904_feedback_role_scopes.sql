-- Separate feedback by submitter role and record its issue type / related page.
begin;

alter table public.development_requests
  add column if not exists submitter_role text,
  add column if not exists feedback_type text,
  add column if not exists related_page text;

update public.development_requests request
set submitter_role = coalesce(profile.role, 'normal')
from public.user_profiles profile
where request.submitter_role is null
  and request.created_by = profile.id;

update public.development_requests
set submitter_role = 'normal'
where submitter_role is null;

update public.development_requests
set feedback_type = 'other'
where feedback_type is null;

alter table public.development_requests
  alter column submitter_role set default 'normal',
  alter column submitter_role set not null,
  alter column feedback_type set default 'other',
  alter column feedback_type set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'development_requests_submitter_role_check'
      and conrelid = 'public.development_requests'::regclass
  ) then
    alter table public.development_requests
      add constraint development_requests_submitter_role_check
      check (submitter_role in ('normal', 'admin', 'super'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'development_requests_feedback_type_check'
      and conrelid = 'public.development_requests'::regclass
  ) then
    alter table public.development_requests
      add constraint development_requests_feedback_type_check
      check (feedback_type in ('bug', 'usability', 'data', 'performance', 'feature', 'optimization', 'other'));
  end if;
end
$$;

create index if not exists development_requests_creator_date_idx
  on public.development_requests (created_by, created_at desc);
create index if not exists development_requests_role_date_idx
  on public.development_requests (submitter_role, created_at desc);
create index if not exists development_requests_creator_status_date_idx
  on public.development_requests (created_by, status, created_at desc);
create index if not exists development_requests_type_date_idx
  on public.development_requests (feedback_type, created_at desc);

commit;
