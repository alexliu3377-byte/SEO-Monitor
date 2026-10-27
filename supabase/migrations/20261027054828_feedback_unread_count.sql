-- Additive, service-only read RPC. Apply only after reviewing the live schema.
-- Preserves existing role visibility and excludes NULL/self latest authors.
begin;

create or replace function public.get_feedback_unread_count(p_viewer_id uuid)
returns bigint
language sql stable security invoker
set search_path = public, pg_temp
as $$
  select count(*)
  from public.development_requests request
  join public.user_profiles viewer on viewer.id = p_viewer_id
    and viewer.is_active is distinct from false
    and viewer.role in ('normal', 'admin', 'super')
  left join public.development_request_message_reads read_state
    on read_state.request_id = request.id and read_state.user_id = viewer.id
  where request.submitter_role in ('normal', 'admin', 'super')
    and (viewer.role = 'super' or request.submitter_role in ('normal', 'admin'))
    and request.latest_message_at is not null
    and request.latest_message_author_id <> viewer.id
    and (read_state.last_read_at is null or read_state.last_read_at < request.latest_message_at);
$$;

revoke all on function public.get_feedback_unread_count(uuid) from public, anon, authenticated;
grant execute on function public.get_feedback_unread_count(uuid) to service_role;

commit;
