begin;
create or replace function public.member_claim_identity(p_keyword text,p_url text,p_operation text,p_source text)
returns text language sql immutable parallel safe set search_path=public as $$
  select case when (p_operation in ('更新','覆盖') or p_source in ('跌词更新','跌排更新','涨排更新'))
    and public.normalize_member_claim_url(p_url)<>'' then 'url:'||public.normalize_member_claim_url(p_url)
    else 'keyword:'||public.normalize_member_claim_keyword(p_keyword) end
$$;
-- Do not delete/reclassify existing tasks to satisfy a new unique index.
-- This transactional guard protects new identities while preserving history.
create or replace function public.guard_member_claim_identity() returns trigger
language plpgsql security definer set search_path=public as $$
declare identity text;
begin
  if new.status='dismissed' then return new; end if;
  identity:=member_claim_identity(new.keyword,new.page_url,new.operation_type,new.source);
  if tg_op='UPDATE' and old.status<>'dismissed' and old.group_id=new.group_id and old.claimed_date=new.claimed_date
    and member_claim_identity(old.keyword,old.page_url,old.operation_type,old.source)=identity then return new; end if;
  perform pg_advisory_xact_lock(hashtextextended(new.group_id::text||':'||new.claimed_date::text||':'||identity,0));
  if exists(select 1 from member_claimed_keywords c where c.group_id=new.group_id and c.claimed_date=new.claimed_date
    and c.status<>'dismissed' and c.id<>new.id
    and member_claim_identity(c.keyword,c.page_url,c.operation_type,c.source)=identity) then
    raise exception 'Task page/keyword already claimed in this group/day' using errcode='23505';
  end if;
  return new;
end;
$$;
drop trigger if exists guard_member_claim_identity on public.member_claimed_keywords;
create trigger guard_member_claim_identity before insert or update on public.member_claimed_keywords
  for each row execute function public.guard_member_claim_identity();
drop index if exists public.member_claimed_keywords_unique_active;
create index if not exists member_claimed_active_identity_idx on public.member_claimed_keywords
  (group_id,claimed_date,public.member_claim_identity(keyword,page_url,operation_type,source)) where status<>'dismissed';
create or replace function public.find_active_task_claim(p_group uuid,p_date date,p_keyword text,p_url text,p_operation text,p_source text)
returns jsonb language sql stable security definer set search_path=public as $$
 select jsonb_build_object('id',id,'user_id',user_id) from member_claimed_keywords
 where group_id=p_group and claimed_date=p_date and status<>'dismissed'
   and member_claim_identity(keyword,page_url,operation_type,source)=member_claim_identity(p_keyword,p_url,p_operation,p_source)
 order by created_at,id limit 1
$$;
revoke all on function public.member_claim_identity(text,text,text,text) from public,anon,authenticated;
grant execute on function public.member_claim_identity(text,text,text,text) to service_role;
revoke all on function public.guard_member_claim_identity() from public,anon,authenticated;
revoke all on function public.find_active_task_claim(uuid,date,text,text,text,text) from public,anon,authenticated;
grant execute on function public.find_active_task_claim(uuid,date,text,text,text,text) to service_role;
commit;
