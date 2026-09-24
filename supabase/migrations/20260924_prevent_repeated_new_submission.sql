-- A member may submit a keyword + URL as "新增" only once. Later work on
-- the same content must be submitted as "更新". Existing historical
-- duplicates are preserved; this rule applies when a record is newly
-- submitted or changed into a submitted "新增" record.
begin;

create or replace function public.normalize_member_claim_keyword(p_keyword text)
returns text
language sql
immutable
parallel safe
set search_path = pg_catalog
as $$
  select lower(regexp_replace(btrim(coalesce(p_keyword, '')), '[[:space:]]+', ' ', 'g'))
$$;

create or replace function public.normalize_member_claim_url(p_url text)
returns text
language plpgsql
immutable
parallel safe
set search_path = pg_catalog
as $$
declare
  v_value text := btrim(coalesce(p_url, ''));
  v_host text;
  v_remainder text;
  v_host_end integer;
begin
  if v_value = '' then
    return '';
  end if;

  v_value := regexp_replace(v_value, '^https?://', '', 'i');
  v_value := regexp_replace(v_value, '^(www\.|m\.)', '', 'i');
  v_value := split_part(v_value, '#', 1);

  v_host_end := nullif(least(
    coalesce(nullif(position('/' in v_value), 0), char_length(v_value) + 1),
    coalesce(nullif(position('?' in v_value), 0), char_length(v_value) + 1)
  ), 0);
  v_host := substring(v_value from 1 for v_host_end - 1);
  v_remainder := substring(v_value from v_host_end);
  v_remainder := regexp_replace(v_remainder, '/+(\?|$)', '\1', 'g');

  return lower(v_host) || v_remainder;
end
$$;

revoke all on function public.normalize_member_claim_keyword(text) from public, anon, authenticated;
revoke all on function public.normalize_member_claim_url(text) from public, anon, authenticated;

create index if not exists member_claimed_user_new_identity_idx
  on public.member_claimed_keywords (
    user_id,
    public.normalize_member_claim_keyword(keyword),
    public.normalize_member_claim_url(page_url)
  )
  where status = 'submitted'
    and operation_type = '新增'
    and page_url is not null;

create or replace function public.prevent_repeated_new_submission()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_keyword text;
  v_url text;
begin
  if new.status <> 'submitted'
     or new.operation_type is distinct from '新增'
     or new.page_url is null then
    return new;
  end if;

  v_keyword := public.normalize_member_claim_keyword(new.keyword);
  v_url := public.normalize_member_claim_url(new.page_url);
  if v_keyword = '' or v_url = '' then
    return new;
  end if;

  -- Keep already-submitted historical rows editable when their identity has
  -- not changed. This preserves old data instead of forcing a cleanup during
  -- migration, while still blocking every new duplicate submission.
  if tg_op = 'UPDATE' then
    if old.status = 'submitted'
       and old.operation_type = '新增'
       and new.user_id is not distinct from old.user_id
       and v_keyword = public.normalize_member_claim_keyword(old.keyword)
       and v_url = public.normalize_member_claim_url(old.page_url) then
      return new;
    end if;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(new.user_id::text || '|' || v_keyword || '|' || v_url, 0)
  );

  if exists (
    select 1
    from public.member_claimed_keywords existing
    where existing.user_id = new.user_id
      and existing.status = 'submitted'
      and existing.operation_type = '新增'
      and existing.id is distinct from new.id
      and public.normalize_member_claim_keyword(existing.keyword) = v_keyword
      and public.normalize_member_claim_url(existing.page_url) = v_url
  ) then
    raise exception 'DUPLICATE_NEW_SUBMISSION: use 更新 for an existing member keyword and URL'
      using errcode = '23505';
  end if;

  return new;
end
$$;

revoke all on function public.prevent_repeated_new_submission() from public, anon, authenticated;

drop trigger if exists prevent_repeated_new_submission
  on public.member_claimed_keywords;
create trigger prevent_repeated_new_submission
  before insert or update of user_id, keyword, page_url, operation_type, status
  on public.member_claimed_keywords
  for each row execute function public.prevent_repeated_new_submission();

commit;
