begin;
create table if not exists public.content_feed_transcripts (
  item_id uuid primary key references public.content_feed_items(id) on delete cascade,
  status text not null default 'queued' check (status in ('queued','processing','completed','blocked','failed','not_video','no_speech')),
  attempts integer not null default 0 check (attempts between 0 and 3),
  lease_token uuid,
  lease_expires_at timestamptz,
  next_attempt_at timestamptz not null default now(),
  transcript_text text not null default '' check (length(transcript_text) <= 120000),
  original_text text not null default '' check (length(original_text) <= 120000),
  text_source text not null default 'local_asr' check (text_source in ('platform_manual','platform_auto','local_asr')),
  segments jsonb not null default '[]'::jsonb check (jsonb_typeof(segments) = 'array' and jsonb_array_length(segments) <= 5000),
  language text,
  model text,
  duration_seconds double precision,
  error_message text check (length(error_message) <= 500),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  check (status <> 'completed' or (length(transcript_text) > 0 and jsonb_array_length(segments) > 0))
);
create index if not exists content_transcript_queue_idx on public.content_feed_transcripts(next_attempt_at, item_id)
  where status in ('queued','failed','blocked','processing');
alter table public.content_feed_transcripts enable row level security;
revoke all on public.content_feed_transcripts from public, anon, authenticated;
grant all on public.content_feed_transcripts to service_role;

-- Stable item identity deduplicates jobs, even if a source changes its title
-- or refreshes a signed link. Successful text is never erased by re-collection.
create or replace function public.enqueue_content_transcript() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.source in ('bilibili','xiaohongshu') then
    insert into public.content_feed_transcripts(item_id) values(new.id)
    on conflict(item_id) do update set status = 'queued', attempts = 0, next_attempt_at = now(), updated_at = now()
    where content_feed_transcripts.status = 'blocked'
      and content_feed_transcripts.error_message like '平台要求登录%'
      and content_feed_transcripts.updated_at < now() - interval '1 hour';
  end if;
  return new;
end;
$$;
revoke all on function public.enqueue_content_transcript() from public, anon, authenticated;
drop trigger if exists enqueue_content_transcript on public.content_feed_items;
create trigger enqueue_content_transcript after insert or update on public.content_feed_items
  for each row execute function public.enqueue_content_transcript();

-- Atomic leases prevent two computers/tasks from processing the same video.
create or replace function public.claim_content_transcript(p_sources text[]) returns jsonb
language plpgsql security definer set search_path = public as $$
declare candidate uuid; token uuid := gen_random_uuid(); result jsonb;
begin
  if cardinality(p_sources) is null or cardinality(p_sources) < 1
    or not p_sources <@ array['bilibili','xiaohongshu']::text[] then
    raise exception 'Unsupported transcription sources';
  end if;
  update public.content_feed_transcripts set status = 'failed', lease_token = null, lease_expires_at = null,
    updated_at = now(), error_message = '本地任务已连续三次超时，请检查采集电脑上的转写程序。'
    where status = 'processing' and lease_expires_at <= now() and attempts >= 3;
  select t.item_id into candidate from public.content_feed_transcripts t
    join public.content_feed_items i on i.id = t.item_id
    where i.source = any(p_sources) and t.attempts < 3 and (
      (t.status in ('queued','failed','blocked') and t.next_attempt_at <= now())
      or (t.status = 'processing' and t.lease_expires_at <= now())
    ) order by i.first_seen_at desc, t.item_id for update of t skip locked limit 1;
  if candidate is null then return null; end if;
  update public.content_feed_transcripts set status = 'processing', attempts = attempts + 1,
    lease_token = token, lease_expires_at = now() + interval '2 hours', updated_at = now()
    where item_id = candidate;
  select jsonb_build_object('itemId', i.id, 'source', i.source, 'url', i.url, 'title', i.title, 'leaseToken', token)
    into result from public.content_feed_items i where i.id = candidate;
  return result;
end;
$$;

create or replace function public.finish_content_transcript(
  p_item_id uuid, p_lease_token uuid, p_status text, p_text text, p_segments jsonb,
  p_message text, p_language text, p_model text, p_duration double precision,
  p_original_text text, p_text_source text
) returns boolean language plpgsql security definer set search_path = public as $$
declare affected integer;
begin
  if p_status not in ('completed','blocked','failed','not_video','no_speech') then raise exception 'Invalid transcript result'; end if;
  if p_status = 'completed' and (coalesce(length(p_text),0) = 0 or coalesce(jsonb_array_length(p_segments),0) = 0) then
    raise exception 'Completed transcription must contain text';
  end if;
  update public.content_feed_transcripts set status = p_status,
    transcript_text = coalesce(p_text,''), segments = coalesce(p_segments,'[]'::jsonb),
    original_text = coalesce(p_original_text,''), text_source = p_text_source,
    error_message = nullif(p_message,''), language = p_language, model = p_model, duration_seconds = p_duration,
    lease_token = null, lease_expires_at = null, updated_at = now(),
    completed_at = case when p_status = 'completed' then now() else null end,
    next_attempt_at = now() + case when p_status = 'blocked' then interval '1 day' else interval '6 hours' end
    where item_id = p_item_id and status = 'processing' and lease_token = p_lease_token and lease_expires_at > now();
  get diagnostics affected = row_count;
  return affected = 1;
end;
$$;
revoke all on function public.claim_content_transcript(text[]) from public, anon, authenticated;
revoke all on function public.finish_content_transcript(uuid,uuid,text,text,jsonb,text,text,text,double precision,text,text) from public, anon, authenticated;
grant execute on function public.claim_content_transcript(text[]) to service_role;
grant execute on function public.finish_content_transcript(uuid,uuid,text,text,jsonb,text,text,text,double precision,text,text) to service_role;

-- Preserve all existing metadata; only add jobs for already collected sources.
insert into public.content_feed_transcripts(item_id)
select id from public.content_feed_items where source in ('bilibili','xiaohongshu')
on conflict(item_id) do nothing;
commit;
