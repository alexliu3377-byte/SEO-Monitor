do $test$
declare fixture uuid:=gen_random_uuid(); job jsonb; accepted boolean;
begin
  insert into public.content_feed_items(id,source,source_id,category,title,url,first_seen_at)
  values(fixture,'xiaoheihe_guide','rollback-article-'||fixture::text,'game_guide','回滚测试',
    'https://www.xiaoheihe.cn/app/bbs/link/999999999','2099-01-01');
  if(select count(*) from public.content_feed_transcripts where item_id=fixture)<>1 then raise exception 'article not queued'; end if;
  job:=public.claim_content_transcript(array['xiaoheihe_guide']);
  if job->>'itemId'<>fixture::text then raise exception 'article fixture not claimed'; end if;
  accepted:=public.finish_content_transcript(fixture,(job->>'leaseToken')::uuid,'blocked','','[]'::jsonb,
    '视频要求登录，正文已保留','zh','test',null,'','article_body','文章正文','文章正文',true);
  if not accepted then raise exception 'partial article rejected'; end if;
  if(select article_text from public.content_feed_transcripts where item_id=fixture)<>'文章正文' then raise exception 'body lost on blocked video'; end if;
  if(select status from public.content_feed_transcripts where item_id=fixture)='completed' then raise exception 'blocked video marked completed'; end if;
  update public.content_feed_transcripts set next_attempt_at=now() where item_id=fixture;
  job:=public.claim_content_transcript(array['xiaoheihe_guide']);
  accepted:=public.finish_content_transcript(fixture,(job->>'leaseToken')::uuid,'failed','','[]'::jsonb,
    '本轮网络错误','zh','test',null,'','local_asr','','',false);
  if not accepted or (select article_text from public.content_feed_transcripts where item_id=fixture)<>'文章正文' then raise exception 'retry erased previous body'; end if;
  update public.content_feed_transcripts set next_attempt_at=now() where item_id=fixture;
  job:=public.claim_content_transcript(array['xiaoheihe_guide']);
  accepted:=public.finish_content_transcript(fixture,(job->>'leaseToken')::uuid,'completed','视频文字',
    '[{"start":0,"end":2,"text":"视频文字"}]'::jsonb,'','zh','test',2,'視頻文字','platform_auto','','',true);
  if not accepted or (select article_text from public.content_feed_transcripts where item_id=fixture)<>'文章正文' then raise exception 'video completion lost body'; end if;
end;
$test$;

do $test$
declare fixture uuid:=gen_random_uuid(); job jsonb; accepted boolean;
begin
  insert into public.content_feed_items(id,source,source_id,category,title,url,first_seen_at)
  values(fixture,'xiaoheihe_ns','rollback-body-'||fixture::text,'ns_game','回滚测试',
    'https://www.xiaoheihe.cn/app/bbs/link/999999998','2099-01-02');
  job:=public.claim_content_transcript(array['xiaoheihe_ns']);
  if job->>'itemId'<>fixture::text then raise exception 'NS fixture not claimed'; end if;
  accepted:=public.finish_content_transcript(fixture,(job->>'leaseToken')::uuid,'completed','','[]'::jsonb,
    '','zh','platform-article-body',null,'','article_body','游戏正文','遊戲正文',false);
  if not accepted then raise exception 'article-only result rejected'; end if;
  update public.content_feed_items set title='改名仍保留正文' where id=fixture;
  if(select article_text from public.content_feed_transcripts where item_id=fixture)<>'游戏正文' then raise exception 'recollection erased body'; end if;
  if(select original_article_text from public.content_feed_transcripts where item_id=fixture)<>'遊戲正文' then raise exception 'raw article lost'; end if;
  if has_table_privilege('authenticated','public.content_feed_transcripts','select') then raise exception 'table exposed'; end if;
  if has_function_privilege('authenticated','public.finish_content_transcript(uuid,uuid,text,text,jsonb,text,text,text,double precision,text,text,text,text,boolean)','execute') then raise exception 'writer RPC exposed'; end if;
end;
$test$;
select 'article/body/video partial/identity/privacy checks passed; rollback' as result;
rollback;
