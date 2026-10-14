-- Append to the migration with its COMMIT removed. ALWAYS run in a rollback
-- transaction. Fixtures use fresh groups/claims; existing profiles are read only.
do $$
declare
  g uuid := gen_random_uuid(); g2 uuid := gen_random_uuid(); c uuid := gen_random_uuid(); other_c uuid := gen_random_uuid();
  actor uuid; previous_actor uuid; outsider uuid;
  day date := timezone('Asia/Kuala_Lumpur', clock_timestamp())::date;
  old_title text := 'overwrite-smoke-old-' || c::text;
  new_title text := 'overwrite-smoke-new-' || c::text;
  absent_title text := 'overwrite-smoke-absent-' || c::text;
  url text := 'https://www.overwrite-test.invalid/Page-' || c::text || '.html?item=1';
  old_created timestamptz := clock_timestamp() - interval '10 days';
  lookup jsonb; result jsonb; version text; old_version text; good_payload jsonb; bad_payload jsonb;
begin
  select id into actor from public.user_profiles where role = 'normal' and is_active order by id limit 1;
  select id into previous_actor from public.user_profiles where role = 'normal' and is_active and id <> actor order by id limit 1;
  select id into outsider from public.user_profiles where role = 'normal' and is_active and id not in (actor, previous_actor) order by id limit 1;
  if actor is null or previous_actor is null or outsider is null then raise exception 'Requires 3 active normal profiles'; end if;
  insert into public.task_groups (id,name) values (g,'ROLLBACK overwrite smoke'),(g2,'ROLLBACK isolated smoke');
  insert into public.task_group_members (group_id,user_id,username) values
    (g,actor,'Smoke actor'),(g,previous_actor,'Smoke previous'),(g2,actor,'Smoke actor');
  insert into public.member_claimed_keywords (id,group_id,user_id,keyword,final_keyword,page_url,source,status,operation_type,claimed_date,submitted_at,created_at,search_volume)
    values (c,g,previous_actor,old_title,old_title || '-final',url,'搜索量查询','submitted','新增',day-5,now()-interval '5 days',old_created,999);
  insert into public.member_claimed_keywords (id,group_id,user_id,keyword,page_url,source,status,claimed_date)
    values (other_c,g,actor,old_title || '-pending',url,'手动添加','pending',day);
  insert into public.member_claimed_keywords (group_id,user_id,keyword,page_url,source,status,operation_type,claimed_date)
    values (g2,actor,old_title || '-other-group',url,'手动添加','submitted','更新',day-1);
  insert into public.keyword_volume (keyword,volume,stat_date) values (new_title,321,day);
  insert into public.site_tracking_records (claim_id,group_id,user_id,keyword,final_keyword,page_url,operation_type,search_volume,submit_date,record_date,rank_position,rank_volume,effectiveness)
    values (c,g,previous_actor,old_title,old_title || '-final',url,'新增',999,day-5,day-1,10,500,'获取排名');
  insert into public.site_tracking_rank_matches (claim_id,record_date,keyword,rank_position,volume)
    values (c,day-1,'Smoke rank',10,500);

  lookup := public.find_group_submissions_for_overwrite(actor,g,replace(url,'https://www.','http://m.') || '#detail',0);
  if (lookup->>'total')::integer <> 1 or lookup->'rows'->0->>'user_id' <> previous_actor::text then raise exception 'All-member exact lookup failed or leaked pending/other-group submissions'; end if;
  version := lookup->'rows'->0->>'version'; old_version := version;
  if public.find_group_submissions_for_overwrite(actor,g,replace(url,'Page-','page-'),0)->>'total' <> '0' then raise exception 'Path casing merged'; end if;
  if public.find_group_submissions_for_overwrite(actor,g,replace(url,'item=1','item=2'),0)->>'total' <> '0' then raise exception 'Query identity merged'; end if;
  begin
    perform public.find_group_submissions_for_overwrite(outsider,g,url,0);
    raise exception 'Outsider lookup unexpectedly allowed';
  exception when insufficient_privilege then null; end;

  bad_payload := jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'claim_id',c,'user_id',previous_actor,
    'keyword',old_title,'final_keyword',old_title||'-final','submit_date',day-5,'record_date',day-1,
    'source','搜索量查询','operation_type','新增','search_volume',999,'effectiveness','获取排名'));
  perform public.replace_group_tracking_paged_cache(g,bad_payload,'{"version":2,"months":{}}'::jsonb,clock_timestamp());
  result := public.overwrite_group_submission(actor,g,c,version,new_title);
  if result->>'pageUrl' <> url or result->>'volume' <> '321' or result->>'volumeMatched' <> 'true' then raise exception 'URL/volume incorrect'; end if;
  if not exists (select 1 from public.member_claimed_keywords where id=c and group_id=g and user_id=actor and keyword=new_title and final_keyword=new_title
    and page_url=url and operation_type='覆盖' and source='手动添加' and claimed_date=day and created_at=old_created and search_volume=321
    and timezone('Asia/Kuala_Lumpur',submitted_at)::date=day) then raise exception 'Submission replacement incorrect'; end if;
  if (select count(*) from public.member_claimed_keywords where group_id=g) <> 2 then raise exception 'Extra submission created'; end if;
  if not exists(select 1 from public.submission_overwrite_history where claim_id=c and actor_id=actor and actor_name='Smoke actor'
    and old_username='Smoke previous' and before_submission->>'keyword'=old_title and before_submission->>'user_id'=previous_actor::text
    and after_submission->>'keyword'=new_title and before_tracking->>'keyword'=old_title) then raise exception 'History snapshot incorrect'; end if;
  if not exists(select 1 from public.site_tracking_records where claim_id=c and record_date=day-1 and user_id=previous_actor and keyword=old_title) then raise exception 'Old tracking changed'; end if;
  if not exists(select 1 from public.site_tracking_records where claim_id=c and record_date=day and user_id=actor and keyword=new_title and operation_type='覆盖') then raise exception 'Latest tracking missing'; end if;
  if not exists(select 1 from public.site_tracking_rank_matches where claim_id=c and record_date=day and keyword='Smoke rank') then raise exception 'Rank evidence missing'; end if;
  if exists(select 1 from public.group_tracking_cache_state where group_id=g) or exists(select 1 from public.group_tracking_cache_rows where group_id=g)
    or exists(select 1 from public.group_tracking_cache where group_id=g) then raise exception 'Old-owner cache survived'; end if;

  begin
    perform public.overwrite_group_submission(actor,g,c,old_version,new_title||'-stale');
    raise exception 'Stale write unexpectedly allowed';
  exception when serialization_failure then if sqlerrm <> 'OVERWRITE_STALE' then raise; end if; end;
  begin
    perform public.overwrite_group_submission(outsider,g,c,old_version,new_title||'-forbidden');
    raise exception 'Outsider mutation unexpectedly allowed';
  exception when insufficient_privilege then null; end;
  begin
    perform public.overwrite_group_submission(actor,g2,c,old_version,new_title||'-wrong-group');
    raise exception 'Wrong-group mutation unexpectedly allowed';
  exception when no_data_found then null; end;
  if (select count(*) from public.submission_overwrite_history where claim_id=c) <> 1 then raise exception 'Failed writes produced history'; end if;

  good_payload := jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'claim_id',c,'user_id',actor,
    'keyword',new_title,'final_keyword',new_title,'submit_date',day,'record_date',day,
    'source','手动添加','operation_type','覆盖','search_volume',321,'effectiveness','获取排名'));
  perform public.replace_group_tracking_paged_cache(g,good_payload,'{"version":2,"months":{}}'::jsonb,clock_timestamp());
  begin
    perform public.replace_group_tracking_paged_cache(g,bad_payload,'{"version":2,"months":{}}'::jsonb,clock_timestamp());
    raise exception 'Stale cache unexpectedly allowed';
  exception when serialization_failure then if sqlerrm <> 'OVERWRITE_CACHE_STALE' then raise; end if; end;
  if (select payload->0->>'user_id' from public.group_tracking_cache where group_id=g) <> actor::text then raise exception 'Stale cache changed valid cache'; end if;

  -- An in-flight crawler writes a snapshot from its old in-memory claim.
  insert into public.site_tracking_records (claim_id,group_id,user_id,keyword,final_keyword,page_url,operation_type,search_volume,submit_date,record_date)
    values (c,g,previous_actor,old_title,old_title,url,'新增',999,day-5,day+1);
  if not exists(select 1 from public.site_tracking_records where claim_id=c and record_date=day+1 and user_id=actor and keyword=new_title and operation_type='覆盖' and submit_date=day and search_volume=321) then raise exception 'In-flight crawler reverted identity'; end if;

  lookup := public.find_group_submissions_for_overwrite(actor,g,url,0); version := lookup->'rows'->0->>'version';
  result := public.overwrite_group_submission(actor,g,c,version,absent_title);
  if result->>'volumeMatched' <> 'false' or result->>'volume' <> '0' then raise exception 'Unmatched keyword reused old volume'; end if;
  if (select count(*) from public.submission_overwrite_history where claim_id=c) <> 2 then raise exception 'Repeated overwrite history lost'; end if;
  lookup := public.find_group_submissions_for_overwrite(actor,g,url,0); version := lookup->'rows'->0->>'version';
  update public.member_claimed_keywords set keyword=new_title||'-conflict' where id=other_c;
  begin
    perform public.overwrite_group_submission(actor,g,c,version,new_title||'-conflict');
    raise exception 'Conflicting active word unexpectedly allowed';
  exception when unique_violation then null; end;
  if (select keyword from public.member_claimed_keywords where id=c) <> absent_title or (select count(*) from public.submission_overwrite_history where claim_id=c) <> 2 then raise exception 'Conflict did not rollback atomically'; end if;
  if has_function_privilege('authenticated','public.overwrite_group_submission(uuid,uuid,uuid,text,text)','execute')
    or has_table_privilege('authenticated','public.submission_overwrite_history','select')
    or has_function_privilege('anon','public.find_group_submissions_for_overwrite(uuid,uuid,text,integer)','execute') then raise exception 'Direct client access leaked'; end if;
end $$;
select 'Submission overwrite transactional smoke tests passed (rollback)' as result;
rollback;
