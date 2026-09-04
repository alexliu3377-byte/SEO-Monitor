-- Preserve former employees and their historical results while revoking all
-- current application access. Run this before using the account offboarding UI.
begin;

alter table public.user_profiles
  add column if not exists is_active boolean not null default true,
  add column if not exists disabled_at timestamptz,
  add column if not exists disabled_by uuid;

create index if not exists user_profiles_active_idx
  on public.user_profiles (is_active, role);

create or replace function public.offboard_user(
  p_user_id uuid,
  p_actor_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor_role text;
  v_actor_active boolean;
  v_target_role text;
  v_group_ids uuid[] := '{}'::uuid[];
  v_memberships integer := 0;
  v_site_grants integer := 0;
  v_pending_claims integer := 0;
  v_disabled_at timestamptz := now();
begin
  select role, is_active
    into v_actor_role, v_actor_active
  from public.user_profiles
  where id = p_actor_id;

  if not found or not v_actor_active or v_actor_role not in ('admin', 'super') then
    raise exception 'Actor is not allowed to offboard accounts' using errcode = '42501';
  end if;

  if p_actor_id = p_user_id then
    raise exception 'An account cannot offboard itself' using errcode = '22023';
  end if;

  select role
    into v_target_role
  from public.user_profiles
  where id = p_user_id
  for update;

  if not found then
    raise exception 'Target account was not found' using errcode = 'P0002';
  end if;

  if v_actor_role = 'admin' and v_target_role <> 'normal' then
    raise exception 'Administrators can only offboard normal accounts' using errcode = '42501';
  end if;

  select coalesce(array_agg(distinct group_id), '{}'::uuid[])
    into v_group_ids
  from public.task_group_members
  where user_id = p_user_id;

  -- Pending claims must no longer block another member from taking the work.
  -- Submitted claims are intentionally untouched and remain attributed to the
  -- former employee for historical reports.
  update public.member_claimed_keywords
  set status = 'dismissed'
  where user_id = p_user_id
    and status = 'pending';
  get diagnostics v_pending_claims = row_count;

  delete from public.task_group_members where user_id = p_user_id;
  get diagnostics v_memberships = row_count;

  delete from public.user_site_access where user_id = p_user_id;
  get diagnostics v_site_grants = row_count;

  update public.user_profiles
  set is_active = false,
      disabled_at = v_disabled_at,
      disabled_by = p_actor_id
  where id = p_user_id;

  return jsonb_build_object(
    'group_ids', to_jsonb(v_group_ids),
    'removed_memberships', v_memberships,
    'removed_site_grants', v_site_grants,
    'dismissed_pending_claims', v_pending_claims,
    'disabled_at', v_disabled_at
  );
end
$$;

revoke all on function public.offboard_user(uuid, uuid) from public, anon, authenticated;
grant execute on function public.offboard_user(uuid, uuid) to service_role;

commit;
