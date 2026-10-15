-- Append to migration with COMMIT removed; fixtures always roll back.
do $$
declare
  g uuid:=gen_random_uuid(); g2 uuid:=gen_random_uuid();
  a uuid; b uuid; outsider uuid;
  day date:=timezone('Asia/Kuala_Lumpur',now())::date;
  prefix text:='recipient-smoke-'||g::text||'-';
  claim_id uuid:=gen_random_uuid(); allowed_claim uuid:=gen_random_uuid();
begin
  select id into a from public.user_profiles where is_active and role='normal' order by id limit 1;
  select id into b from public.user_profiles where is_active and role='normal' and id<>a order by id limit 1;
  select id into outsider from public.user_profiles where is_active and role='normal' and id not in(a,b) order by id limit 1;
  if a is null or b is null or outsider is null then raise exception 'Need 3 active normal profiles'; end if;
  insert into public.task_groups(id,name) values(g,'ROLLBACK recipient smoke'),(g2,'ROLLBACK other group');
  insert into public.task_group_members(group_id,user_id,username) values(g,a,'Selected'),(g,b,'Not selected'),(g2,outsider,'Other group');
  insert into public.distributed_keywords(group_id,keyword,added_by,recipient_user_ids) values
    (g,prefix||'all',a,null), (g,prefix||'selected',a,array[a]),
    (g,prefix||'other',a,array[b]), (g,prefix||'multiple',a,array[a,b]);
  if (select count(*) from public.distributed_keywords where group_id=g and (recipient_user_ids is null or recipient_user_ids @> array[a]))<>3 then raise exception 'Member list filtering failed'; end if;
  if (select count(*) from public.distributed_keywords where group_id=g)<>4 then raise exception 'Admin list lost rows'; end if;

  begin
    insert into public.distributed_keywords(group_id,keyword,added_by,recipient_user_ids) values(g,prefix||'empty',a,'{}'::uuid[]);
    raise exception 'Empty array unexpectedly accepted';
  exception when invalid_parameter_value then null; end;
  begin
    insert into public.distributed_keywords(group_id,keyword,added_by,recipient_user_ids) values(g,prefix||'wrong-group',a,array[outsider]);
    raise exception 'Cross-group recipient unexpectedly accepted';
  exception when invalid_parameter_value then null; end;
  begin
    insert into public.distributed_keywords(group_id,keyword,added_by,recipient_user_ids) values(g,prefix||'null-recipient',a,array[null]::uuid[]);
    raise exception 'NULL recipient unexpectedly accepted';
  exception when invalid_parameter_value then null; end;

  insert into public.member_claimed_keywords(id,group_id,user_id,keyword,source,status,claimed_date)
    values(allowed_claim,g,a,prefix||'selected','分发词','pending',day);
  if not exists(select 1 from public.member_claimed_keywords where id=allowed_claim and status='pending') then raise exception 'Selected recipient could not claim'; end if;
  begin
    insert into public.member_claimed_keywords(group_id,user_id,keyword,source,status,claimed_date)
      values(g,b,prefix||'selected','分发词','pending',day-1);
    raise exception 'Unselected recipient bypassed claim endpoint';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.member_claimed_keywords(group_id,user_id,keyword,source,status,claimed_date)
      values(g,outsider,prefix||'all','分发词','pending',day);
    raise exception 'Nonmember claimed group distribution';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.member_claimed_keywords(group_id,user_id,keyword,source,status,claimed_date)
      values(g,a,prefix||'nonexistent','分发词','pending',day);
    raise exception 'Forged distribution accepted';
  exception when no_data_found then null; end;

  -- All-group behavior remains compatible and multi-member pools permit
  -- either selected recipient, not one independently credited copy per person.
  insert into public.member_claimed_keywords(id,group_id,user_id,keyword,source,status,claimed_date)
    values(claim_id,g,b,prefix||'all','分发词','pending',day);
  insert into public.member_claimed_keywords(group_id,user_id,keyword,source,status,claimed_date)
    values(g,b,prefix||'multiple','分发词','pending',day);
  update public.distributed_keywords set recipient_user_ids=array[a] where group_id=g and keyword=prefix||'all';
  update public.member_claimed_keywords set operation_type='更新', final_keyword=prefix||'all',page_url='https://test.invalid/a',status='submitted' where id=claim_id;
  if not exists(select 1 from public.member_claimed_keywords where id=claim_id and status='submitted' and user_id=b) then raise exception 'Reassignment broke an existing task'; end if;
  update public.member_claimed_keywords set status='dismissed' where id=claim_id;
  begin
    update public.member_claimed_keywords set status='pending' where id=claim_id;
    raise exception 'Dismissed record bypassed new assignment';
  exception when insufficient_privilege then null; end;
  delete from public.distributed_keywords where group_id=g and keyword=prefix||'selected';
  update public.member_claimed_keywords set operation_type='更新', final_keyword=prefix||'selected',page_url='https://test.invalid/b',status='submitted' where id=allowed_claim;
  if not exists(select 1 from public.member_claimed_keywords where id=allowed_claim and status='submitted') then raise exception 'Deleting distribution broke an existing task'; end if;
  if has_table_privilege('authenticated','public.distributed_keywords','select')
    or has_table_privilege('authenticated','public.distributed_keywords','update')
    or has_table_privilege('anon','public.distributed_keywords','select') then raise exception 'Direct browser access leaked'; end if;
end $$;
select 'Distributed recipient smoke tests passed (rollback)' as result;
rollback;
