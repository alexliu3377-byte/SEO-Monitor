begin;

-- An expired lease proves only that no finish was confirmed. It does not prove
-- a model timeout: result validation, transport or a stopped worker can do it.
-- No attempts/status/history reset; completed text is never touched.
create or replace function public.claim_content_transcript(p_sources text[]) returns jsonb
language plpgsql security definer set search_path=public as $$
declare candidate uuid; token uuid:=gen_random_uuid(); result jsonb;
begin
  if cardinality(p_sources) is null or cardinality(p_sources)<1
    or not p_sources <@ array['bilibili','xiaohongshu','xiaoheihe_guide','xiaoheihe_ns']::text[] then
    raise exception 'Unsupported text sources';
  end if;
  update public.content_feed_transcripts t set status='failed',lease_token=null,lease_expires_at=null,
    updated_at=now(),error_message='连续三次处理未在租约内确认回写；可能是程序中断、处理超时或结果回写失败，请检查采集电脑日志。'
    where t.status='processing' and t.lease_expires_at<=now() and t.attempts>=3
      and exists(select 1 from public.content_feed_items i where i.id=t.item_id and i.source=any(p_sources));
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

commit;
