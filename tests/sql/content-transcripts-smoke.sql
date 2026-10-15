-- Append after the migration without its final COMMIT. Always ROLLBACK.
do $test$
declare job jsonb; second_job jsonb; fixture uuid := gen_random_uuid(); accepted boolean;
begin
  insert into public.content_feed_items(id,source,source_id,category,title,url,first_seen_at)
  values(fixture,'bilibili','rollback-transcript-' || fixture::text,'video','回滚测试',
    'https://www.bilibili.com/video/rollback-' || fixture::text, '2099-01-01');
  if (select count(*) from public.content_feed_transcripts where item_id=fixture) <> 1 then raise exception 'automatic enqueue failed'; end if;
  job := public.claim_content_transcript(array['bilibili']);
  if job->>'itemId' <> fixture::text then raise exception 'fixture not claimed'; end if;
  second_job := public.claim_content_transcript(array['bilibili']);
  if second_job->>'itemId' = fixture::text then raise exception 'duplicate lease'; end if;
  accepted := public.finish_content_transcript(fixture,gen_random_uuid(),'completed','测试文字',
    '[{"start":0,"end":2,"text":"测试文字"}]'::jsonb,'','zh','platform-subtitles/ai-zh',2,'測試文字','platform_auto');
  if accepted then raise exception 'wrong lease accepted'; end if;
  accepted := public.finish_content_transcript(fixture,(job->>'leaseToken')::uuid,'completed','测试文字',
    '[{"start":0,"end":2,"text":"测试文字"}]'::jsonb,'','zh','platform-subtitles/ai-zh',2,'測試文字','platform_auto');
  if not accepted then raise exception 'valid result rejected'; end if;
  if (select original_text from public.content_feed_transcripts where item_id=fixture) <> '測試文字' then raise exception 'raw text lost'; end if;
  if (select text_source from public.content_feed_transcripts where item_id=fixture) <> 'platform_auto' then raise exception 'auto caption mislabelled'; end if;
  accepted := public.finish_content_transcript(fixture,(job->>'leaseToken')::uuid,'completed','旧任务覆盖',
    '[{"start":0,"end":2,"text":"旧任务覆盖"}]'::jsonb,'','zh','test',2,'旧任务覆盖','local_asr');
  if accepted then raise exception 'completed text overwritten by stale lease'; end if;
  update public.content_feed_items set title='改名测试' where id=fixture;
  if (select transcript_text from public.content_feed_transcripts where item_id=fixture) <> '测试文字' then raise exception 'recollection erased text'; end if;
  update public.content_feed_transcripts set status='processing',attempts=3,lease_expires_at=now()-interval '1 minute' where item_id=fixture;
  perform public.claim_content_transcript(array['bilibili']);
  if (select status from public.content_feed_transcripts where item_id=fixture) <> 'failed' then raise exception 'expired final attempt remains processing'; end if;
  update public.content_feed_transcripts set status='blocked',attempts=3,updated_at=now()-interval '2 hours',error_message='平台要求登录或验证' where item_id=fixture;
  update public.content_feed_items set title='重新登录后采集' where id=fixture;
  if (select status from public.content_feed_transcripts where item_id=fixture) <> 'queued' then raise exception 'recollection did not requeue access block'; end if;
  if has_table_privilege('authenticated','public.content_feed_transcripts','select') then raise exception 'table access leaked'; end if;
  if has_function_privilege('authenticated','public.claim_content_transcript(text[])','execute') then raise exception 'queue access leaked'; end if;
end;
$test$;
select 'transcript queue/provenance/lease checks passed; rollback' as result;
rollback;
