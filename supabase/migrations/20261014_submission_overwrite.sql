-- Exact-URL overwrite is the only exception to member-private report reads.
-- Existing claims retain their IDs and URLs. Every overwrite is atomic and
-- snapshots the old submission (including same-day tracking) before changing it.
begin;

create table if not exists public.submission_overwrite_history (
  id uuid primary key default gen_random_uuid(),
  claim_id uuid references public.member_claimed_keywords(id) on delete set null,
  group_id uuid not null references public.task_groups(id) on delete cascade,
  actor_id uuid not null,
  actor_name text not null,
  old_username text not null,
  before_submission jsonb not null,
  after_submission jsonb not null,
  before_tracking jsonb,
  overwritten_at timestamptz not null default clock_timestamp()
);
create index if not exists submission_overwrite_history_claim_date_idx
  on public.submission_overwrite_history (group_id, claim_id, overwritten_at desc);
create index if not exists submission_overwrite_history_claim_idx
  on public.submission_overwrite_history (claim_id, overwritten_at desc);
create index if not exists member_claimed_group_submitted_url_idx
  on public.member_claimed_keywords (group_id, public.normalize_member_claim_url(page_url), submitted_at desc, id)
  where status = 'submitted' and page_url is not null;
alter table public.submission_overwrite_history enable row level security;
revoke all on public.submission_overwrite_history from public, anon, authenticated;
grant all on public.submission_overwrite_history to service_role;

create or replace function public.can_overwrite_group_submission(p_actor_id uuid, p_group_id uuid)
returns boolean language sql stable security definer set search_path = pg_catalog, public as $$
  select exists (
    select 1 from public.user_profiles p join public.task_groups g on g.id = p_group_id
    where p.id = p_actor_id and p.is_active and (
      p.role = 'super'
      or (p.role = 'normal' and exists (
        select 1 from public.task_group_members m where m.group_id = g.id and m.user_id = p.id
      ))
      or (p.role = 'admin' and exists (
        select 1 from public.user_site_access a join public.sites s on s.id = a.site_id,
          unnest(g.site_domains) d
        where a.user_id = p.id
          and lower(regexp_replace(d, '^(https?://)?(www\.)?', '', 'i')) = lower(regexp_replace(s.domain, '^(https?://)?(www\.)?', '', 'i'))
      ))
    )
  )
$$;

create or replace function public.find_group_submissions_for_overwrite(
  p_actor_id uuid, p_group_id uuid, p_url text, p_offset integer default 0
)
returns jsonb language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare v_result jsonb;
begin
  if not public.can_overwrite_group_submission(p_actor_id, p_group_id) then raise exception 'Forbidden' using errcode = '42501'; end if;
  if p_url is null or length(p_url) not between 1 and 2048 or greatest(p_offset, 0) > 100000 then raise exception 'Invalid lookup' using errcode = '22023'; end if;
  with matches as materialized (
    select c.* from public.member_claimed_keywords c
    where c.group_id = p_group_id and c.status = 'submitted'
      and public.normalize_member_claim_url(c.page_url) = public.normalize_member_claim_url(p_url)
  ), page as (
    select * from matches order by submitted_at desc nulls last, id
    offset greatest(coalesce(p_offset, 0), 0) limit 20
  )
  select jsonb_build_object('total', (select count(*) from matches), 'rows', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', c.id, 'keyword', c.keyword, 'final_keyword', c.final_keyword,
      'page_url', c.page_url, 'user_id', c.user_id,
      'username', coalesce(nullif(btrim(m.username), ''), nullif(btrim(p.username), ''), '未命名成员'),
      'source', c.source, 'operation_type', c.operation_type,
      'submitted_at', c.submitted_at, 'claimed_date', c.claimed_date,
      'search_volume', coalesce(c.search_volume, 0), 'version', md5(to_jsonb(c)::text)
    ) order by c.submitted_at desc nulls last, c.id)
    from page c left join public.task_group_members m on m.group_id = c.group_id and m.user_id = c.user_id
      left join public.user_profiles p on p.id = c.user_id
  ), '[]'::jsonb)) into v_result;
  return v_result;
end $$;

create or replace function public.overwrite_group_submission(
  p_actor_id uuid, p_group_id uuid, p_claim_id uuid, p_expected_version text, p_keyword text
)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_before public.member_claimed_keywords%rowtype;
  v_after public.member_claimed_keywords%rowtype;
  v_track public.site_tracking_records%rowtype;
  v_now timestamptz := clock_timestamp();
  v_day date := (timezone('Asia/Kuala_Lumpur', v_now))::date;
  v_keyword text := btrim(p_keyword);
  v_volume bigint := 0;
  v_volume_date date;
  v_actor_name text;
  v_old_name text;
  v_history_id uuid;
begin
  if not public.can_overwrite_group_submission(p_actor_id, p_group_id) then raise exception 'Forbidden' using errcode = '42501'; end if;
  if v_keyword is null or length(v_keyword) not between 1 and 200 or v_keyword ~ '[[:cntrl:]]' then raise exception 'Invalid overwrite keyword' using errcode = '22023'; end if;
  -- Use the same lock as the paged cache writer, before locking the claim.
  perform pg_advisory_xact_lock(hashtextextended('group-tracking-cache|' || p_group_id::text, 0));
  select * into v_before from public.member_claimed_keywords
    where id = p_claim_id and group_id = p_group_id and status = 'submitted' and nullif(btrim(page_url), '') is not null for update;
  if not found then raise exception 'OVERWRITE_NOT_FOUND' using errcode = 'P0002'; end if;
  if p_expected_version is null or md5(to_jsonb(v_before)::text) <> p_expected_version then raise exception 'OVERWRITE_STALE' using errcode = '40001'; end if;

  select coalesce(nullif(btrim(m.username), ''), nullif(btrim(p.username), ''), '未命名成员') into v_actor_name
    from public.user_profiles p left join public.task_group_members m on m.user_id = p.id and m.group_id = p_group_id where p.id = p_actor_id;
  select coalesce(nullif(btrim(m.username), ''), nullif(btrim(p.username), ''), '未命名成员') into v_old_name
    from public.user_profiles p left join public.task_group_members m on m.user_id = p.id and m.group_id = p_group_id where p.id = v_before.user_id;
  select volume, stat_date into v_volume, v_volume_date from public.keyword_volume where keyword = v_keyword;
  select * into v_track from public.site_tracking_records where claim_id = p_claim_id
    order by record_date desc, id limit 1;

  update public.member_claimed_keywords set keyword = v_keyword, final_keyword = v_keyword,
    user_id = p_actor_id, claimed_date = v_day, submitted_at = v_now,
    source = '手动添加', operation_type = '覆盖', source_rule_id = null, experiment_group = null,
    search_volume = coalesce(v_volume, 0)
    -- Keep status, original URL and created_at unchanged.
    where id = p_claim_id returning * into v_after;
  insert into public.submission_overwrite_history (
    claim_id, group_id, actor_id, actor_name, old_username, before_submission, after_submission, before_tracking, overwritten_at
  ) values (p_claim_id, p_group_id, p_actor_id, v_actor_name, coalesce(v_old_name, '未命名成员'),
    to_jsonb(v_before), to_jsonb(v_after), case when v_track.id is null then null else to_jsonb(v_track) end, v_now)
    returning id into v_history_id;

  -- Create/replace only today's snapshot. Older tracking and rank evidence
  -- remain intact; before_tracking also preserves an overwritten same-day row.
  insert into public.site_tracking_records (
    claim_id, group_id, user_id, keyword, final_keyword, page_url, operation_type, search_volume,
    submit_date, record_date, is_indexed, index_first_seen, index_disappeared,
    rank_keyword, rank_position, prev_rank_position, rank_volume, rank_date, effectiveness, updated_at
  ) values (
    p_claim_id, p_group_id, p_actor_id, v_keyword, v_keyword, v_before.page_url, '覆盖', coalesce(v_volume, 0),
    v_day, v_day, coalesce(v_track.is_indexed, false), v_track.index_first_seen, v_track.index_disappeared,
    v_track.rank_keyword, v_track.rank_position, v_track.prev_rank_position, coalesce(v_track.rank_volume, 0), v_track.rank_date,
    case when v_track.rank_position is not null then '获取排名' when v_track.is_indexed then '获取收录' else '追踪中' end, v_now
  ) on conflict (claim_id, record_date) do update set
    user_id = excluded.user_id, keyword = excluded.keyword, final_keyword = excluded.final_keyword,
    page_url = excluded.page_url, operation_type = excluded.operation_type, search_volume = excluded.search_volume,
    submit_date = excluded.submit_date, is_indexed = excluded.is_indexed,
    index_first_seen = excluded.index_first_seen, index_disappeared = excluded.index_disappeared,
    rank_keyword = excluded.rank_keyword, rank_position = excluded.rank_position,
    prev_rank_position = excluded.prev_rank_position, rank_volume = excluded.rank_volume,
    rank_date = excluded.rank_date, effectiveness = excluded.effectiveness, updated_at = excluded.updated_at;
  if v_track.id is not null and v_track.record_date <> v_day then
    insert into public.site_tracking_rank_matches (claim_id, record_date, keyword, rank_position, prev_rank_position, volume)
      select claim_id, v_day, keyword, rank_position, prev_rank_position, volume
      from public.site_tracking_rank_matches where claim_id = p_claim_id and record_date = v_track.record_date
      on conflict (claim_id, record_date, keyword) do nothing;
  end if;

  -- Never leave the old owner's materialized report readable after a transfer.
  delete from public.group_tracking_cache_rows where group_id = p_group_id;
  delete from public.group_tracking_cache_state where group_id = p_group_id;
  delete from public.group_tracking_cache where group_id = p_group_id;
  return jsonb_build_object('claimId', p_claim_id, 'historyId', v_history_id, 'keyword', v_keyword,
    'pageUrl', v_before.page_url, 'username', v_actor_name, 'submittedAt', v_now,
    'submitDate', v_day, 'volume', coalesce(v_volume, 0), 'volumeMatched', v_volume_date is not null, 'volumeDate', v_volume_date);
end $$;

-- A crawler that read the old claim before an overwrite must not write that
-- old owner's metadata back into the latest tracking snapshot afterward.
create or replace function public.keep_overwritten_tracking_identity()
returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_claim public.member_claimed_keywords%rowtype; v_day date;
begin
  if exists (select 1 from public.submission_overwrite_history where claim_id = new.claim_id) then
    select * into v_claim from public.member_claimed_keywords where id = new.claim_id for share;
    v_day := timezone('Asia/Kuala_Lumpur', v_claim.submitted_at)::date;
    if new.record_date >= v_day then
      new.user_id := v_claim.user_id; new.keyword := v_claim.keyword; new.final_keyword := v_claim.final_keyword;
      new.page_url := v_claim.page_url; new.operation_type := v_claim.operation_type;
      new.search_volume := coalesce(v_claim.search_volume, 0); new.submit_date := v_day;
      if new.effectiveness = '无效' then new.effectiveness := '追踪中'; end if;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists keep_overwritten_tracking_identity on public.site_tracking_records;
create trigger keep_overwritten_tracking_identity before insert or update on public.site_tracking_records
  for each row execute function public.keep_overwritten_tracking_identity();

-- The legacy cache is written last by replace_group_tracking_paged_cache.
-- Raising here rolls back that entire cache transaction if a simultaneous
-- recomputation still contains a pre-overwrite name/member/date/source.
create or replace function public.reject_stale_overwrite_cache()
returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if exists (
    select 1 from jsonb_array_elements(new.payload) item
    join public.member_claimed_keywords c on c.id = (item->>'claim_id')::uuid
    where c.group_id = new.group_id
      and exists (select 1 from public.submission_overwrite_history h where h.claim_id = c.id)
      and (item->>'keyword' is distinct from c.keyword or item->>'final_keyword' is distinct from c.final_keyword
        or item->>'user_id' is distinct from c.user_id::text or item->>'source' is distinct from c.source
        or item->>'submit_date' is distinct from c.claimed_date::text or item->>'operation_type' is distinct from c.operation_type
        or (item->>'search_volume')::bigint is distinct from coalesce(c.search_volume, 0))
  ) then raise exception 'OVERWRITE_CACHE_STALE' using errcode = '40001'; end if;
  return new;
end $$;
drop trigger if exists reject_stale_overwrite_cache on public.group_tracking_cache;
create trigger reject_stale_overwrite_cache before insert or update on public.group_tracking_cache
  for each row execute function public.reject_stale_overwrite_cache();

revoke all on function public.can_overwrite_group_submission(uuid, uuid) from public, anon, authenticated;
revoke all on function public.find_group_submissions_for_overwrite(uuid, uuid, text, integer) from public, anon, authenticated;
revoke all on function public.overwrite_group_submission(uuid, uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.keep_overwritten_tracking_identity() from public, anon, authenticated;
revoke all on function public.reject_stale_overwrite_cache() from public, anon, authenticated;
grant execute on function public.can_overwrite_group_submission(uuid, uuid) to service_role;
grant execute on function public.find_group_submissions_for_overwrite(uuid, uuid, text, integer) to service_role;
grant execute on function public.overwrite_group_submission(uuid, uuid, uuid, text, text) to service_role;

commit;
