begin;
set local lock_timeout='5s';
-- Do not remove duplicate protection unless the URL/keyword identity guard is active.
do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgrelid='public.member_claimed_keywords'::regclass
      and tgname='guard_member_claim_identity'
      and tgfoid='public.guard_member_claim_identity()'::regprocedure
      and tgenabled in ('O','A') and not tgisinternal
  ) then
    raise exception 'Install the active task-identity guard before retiring the keyword-only guard';
  end if;
end;
$$;
-- The retired function remains for migration history; no task rows are touched.
drop trigger if exists prevent_duplicate_active_group_claim on public.member_claimed_keywords;
commit;
