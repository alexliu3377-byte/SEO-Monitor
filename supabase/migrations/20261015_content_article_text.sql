begin;
alter table public.content_feed_transcripts
  add column if not exists article_text text not null default '' check(length(article_text) <= 120000),
  add column if not exists original_article_text text not null default '' check(length(original_article_text) <= 120000),
  add column if not exists video_expected boolean not null default false;
alter table public.content_feed_transcripts drop constraint if exists content_feed_transcripts_text_source_check;
alter table public.content_feed_transcripts add constraint content_feed_transcripts_text_source_check
  check(text_source in ('platform_manual','platform_auto','local_asr','article_body'));
alter table public.content_feed_transcripts drop constraint if exists content_feed_transcripts_check;
alter table public.content_feed_transcripts drop constraint if exists content_feed_transcripts_completed_text_check;
alter table public.content_feed_transcripts add constraint content_feed_transcripts_completed_text_check
  check(status <> 'completed' or (length(transcript_text)>0 and jsonb_array_length(segments)>0)
    or (length(article_text)>0 and not video_expected));

create or replace function public.enqueue_content_transcript() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.source in ('bilibili','xiaohongshu','xiaoheihe_guide','xiaoheihe_ns') then
    insert into public.content_feed_transcripts(item_id) values(new.id)
    on conflict(item_id) do update set status='queued',attempts=0,next_attempt_at=now(),updated_at=now()
    where content_feed_transcripts.status='blocked'
      and content_feed_transcripts.error_message like '平台要求登录%'
      and content_feed_transcripts.updated_at < now()-interval '1 hour';
  end if;
  return new;
end;
$$;
revoke all on function public.enqueue_content_transcript() from public, anon, authenticated;

create or replace function public.claim_content_transcript(p_sources text[]) returns jsonb
language plpgsql security definer set search_path=public as $$
declare candidate uuid; token uuid:=gen_random_uuid(); result jsonb;
begin
  if cardinality(p_sources) is null or cardinality(p_sources)<1
    or not p_sources <@ array['bilibili','xiaohongshu','xiaoheihe_guide','xiaoheihe_ns']::text[] then
    raise exception 'Unsupported text sources';
  end if;
  update public.content_feed_transcripts set status='failed',lease_token=null,lease_expires_at=null,
    updated_at=now(),error_message='本地任务已连续三次超时，请检查采集电脑上的文字处理程序。'
    where status='processing' and lease_expires_at<=now() and attempts>=3;
  select t.item_id into candidate from public.content_feed_transcripts t
    join public.content_feed_items i on i.id=t.item_id
    where i.source=any(p_sources) and t.attempts<3 and (
      (t.status in ('queued','failed','blocked') and t.next_attempt_at<=now())
      or (t.status='processing' and t.lease_expires_at<=now())
    ) order by i.first_seen_at desc,t.item_id for update of t skip locked limit 1;
  if candidate is null then return null; end if;
  update public.content_feed_transcripts set status='processing',attempts=attempts+1,lease_token=token,
    lease_expires_at=now()+interval '2 hours',updated_at=now() where item_id=candidate;
  select jsonb_build_object('itemId',i.id,'source',i.source,'url',i.url,'title',i.title,'leaseToken',token)
    into result from public.content_feed_items i where i.id=candidate;
  return result;
end;
$$;
revoke all on function public.claim_content_transcript(text[]) from public, anon, authenticated;
grant execute on function public.claim_content_transcript(text[]) to service_role;

-- Keep the existing 11-argument RPC for workers already running during rollout.
create or replace function public.finish_content_transcript(
  p_item_id uuid,p_lease_token uuid,p_status text,p_text text,p_segments jsonb,
  p_message text,p_language text,p_model text,p_duration double precision,
  p_original_text text,p_text_source text,p_article_text text,p_original_article_text text,p_video_expected boolean
) returns boolean language plpgsql security definer set search_path=public as $$
declare affected integer;
begin
  if p_status not in ('completed','blocked','failed','not_video','no_speech') then raise exception 'Invalid text result'; end if;
  if p_status='completed' and not (
    (p_text_source='article_body' and coalesce(length(p_article_text),0)>0 and not coalesce(p_video_expected,false)
      and coalesce(length(p_text),0)=0 and coalesce(jsonb_array_length(p_segments),0)=0)
    or (p_text_source<>'article_body' and coalesce(length(p_text),0)>0 and coalesce(jsonb_array_length(p_segments),0)>0)
  ) then raise exception 'Completed text must contain the requested content'; end if;
  update public.content_feed_transcripts set status=p_status,
    transcript_text=coalesce(p_text,''),original_text=coalesce(p_original_text,''),segments=coalesce(p_segments,'[]'::jsonb),
    text_source=p_text_source,
    article_text=coalesce(nullif(p_article_text,''),article_text),
    original_article_text=coalesce(nullif(p_original_article_text,''),original_article_text),
    video_expected=video_expected or coalesce(p_video_expected,false),
    error_message=nullif(p_message,''),language=p_language,model=p_model,duration_seconds=p_duration,
    lease_token=null,lease_expires_at=null,updated_at=now(),
    completed_at=case when p_status='completed' then now() else null end,
    next_attempt_at=now()+case when p_status='blocked' then interval '1 day' else interval '6 hours' end
    where item_id=p_item_id and status='processing' and lease_token=p_lease_token and lease_expires_at>now();
  get diagnostics affected=row_count;
  return affected=1;
end;
$$;
revoke all on function public.finish_content_transcript(uuid,uuid,text,text,jsonb,text,text,text,double precision,text,text,text,text,boolean) from public,anon,authenticated;
grant execute on function public.finish_content_transcript(uuid,uuid,text,text,jsonb,text,text,text,double precision,text,text,text,text,boolean) to service_role;

insert into public.content_feed_transcripts(item_id)
select id from public.content_feed_items where source in ('xiaoheihe_guide','xiaoheihe_ns')
on conflict(item_id) do nothing;
commit;
