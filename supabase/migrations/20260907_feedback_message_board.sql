-- Turn routine feedback into an internal read-only board for all signed-in
-- staff, while allowing only the submitter and project owner to reply.
-- Super-admin priority threads keep their existing super-only discussion model.
begin;

alter table public.development_requests
  add column if not exists submitted_site text;

alter table public.development_requests
  drop constraint if exists development_requests_feedback_type_check;
alter table public.development_requests
  add constraint development_requests_feedback_type_check
  check (feedback_type in (
    'bug', 'usability', 'data', 'performance', 'feature', 'optimization',
    'site_submission', 'other'
  ));

alter table public.development_requests
  drop constraint if exists development_requests_site_submission_check;
alter table public.development_requests
  add constraint development_requests_site_submission_check
  check (
    feedback_type <> 'site_submission'
    or (submitted_site is not null and char_length(btrim(submitted_site)) between 3 and 253)
  );

alter table public.development_request_messages
  drop constraint if exists development_request_messages_author_role_check;
alter table public.development_request_messages
  add constraint development_request_messages_author_role_check
  check (author_role in ('normal', 'admin', 'super'));

create index if not exists development_requests_submitted_site_idx
  on public.development_requests (lower(submitted_site), created_at desc)
  where submitted_site is not null;

commit;
