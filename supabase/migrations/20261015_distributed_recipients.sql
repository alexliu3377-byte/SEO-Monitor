-- No backfill: existing NULL recipient lists remain all-group distributions.
begin;

alter table public.distributed_keywords add column if not exists recipient_user_ids uuid[];
alter table public.distributed_keywords drop constraint if exists distributed_keywords_recipients_check;
alter table public.distributed_keywords add constraint distributed_keywords_recipients_check
  check (recipient_user_ids is null or (
    cardinality(recipient_user_ids) between 1 and 200 and array_position(recipient_user_ids, null) is null
  ));
comment on column public.distributed_keywords.recipient_user_ids is
  'NULL: all group members; nonempty list: only these group members may see/claim. Shared pool, not one copy per member.';

-- This table is already API/service-only (RLS enabled, no client policies).
-- Keep it so; targeted keywords must never leak through browser table reads.
alter table public.distributed_keywords enable row level security;
revoke all on public.distributed_keywords from public, anon, authenticated;
grant all on public.distributed_keywords to service_role;

create or replace function public.validate_distributed_recipients()
returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if new.recipient_user_ids is not null then
    if cardinality(new.recipient_user_ids) not between 1 and 200
      or array_position(new.recipient_user_ids, null) is not null
      or (select count(*) from public.task_group_members m join public.user_profiles p on p.id=m.user_id
        where m.group_id=new.group_id and m.user_id=any(new.recipient_user_ids) and p.is_active)
        <> cardinality(new.recipient_user_ids) then
      raise exception 'DISTRIBUTED_RECIPIENT_INVALID' using errcode='22023';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists validate_distributed_recipients on public.distributed_keywords;
create trigger validate_distributed_recipients before insert or update of group_id,recipient_user_ids
  on public.distributed_keywords for each row execute function public.validate_distributed_recipients();

create or replace function public.enforce_distributed_claim_recipient()
returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_recipients uuid[];
begin
  if new.source is distinct from '分发词' or new.status='dismissed' then return new; end if;
  -- Assignment changes do not revoke work that was already legitimately
  -- claimed. Preserve its editing/submission path, including after deletion
  -- of the original distribution. A new claim/transfer is always rechecked.
  if tg_op='UPDATE' then
    if old.source='分发词' and old.status<>'dismissed'
      and old.group_id is not distinct from new.group_id
      and old.user_id is not distinct from new.user_id
      and old.keyword is not distinct from new.keyword then return new; end if;
  end if;
  select recipient_user_ids into v_recipients from public.distributed_keywords
    where group_id=new.group_id and keyword=new.keyword for share;
  if not found then raise exception 'DISTRIBUTED_WORD_NOT_FOUND' using errcode='P0002'; end if;
  if v_recipients is not null and not (new.user_id=any(v_recipients)) then
    raise exception 'DISTRIBUTED_RECIPIENT_FORBIDDEN' using errcode='42501';
  end if;
  if not exists(select 1 from public.task_group_members m join public.user_profiles p on p.id=m.user_id
    where m.group_id=new.group_id and m.user_id=new.user_id and p.is_active) then
    raise exception 'DISTRIBUTED_RECIPIENT_NOT_MEMBER' using errcode='42501';
  end if;
  return new;
end $$;
drop trigger if exists enforce_distributed_claim_recipient on public.member_claimed_keywords;
create trigger enforce_distributed_claim_recipient before insert or update of group_id,user_id,keyword,source,status
  on public.member_claimed_keywords for each row execute function public.enforce_distributed_claim_recipient();

revoke all on function public.validate_distributed_recipients() from public, anon, authenticated;
revoke all on function public.enforce_distributed_claim_recipient() from public, anon, authenticated;
commit;
