-- Audit hardening migration. Review the duplicate preflight queries before
-- applying this file in Supabase. It intentionally fails instead of deleting
-- or merging existing business data automatically.
begin;

do $$
begin
  if exists (
    select 1 from public.user_profiles
    where username is not null
    group by lower(btrim(username)) having count(*) > 1
  ) then
    raise exception 'Duplicate usernames must be resolved before applying this migration';
  end if;

  if exists (
    select 1 from public.member_claimed_keywords
    where group_id is null or user_id is null or claimed_date is null or keyword is null or status is null
  ) then
    raise exception 'Claim ownership/date/status fields contain null values';
  end if;

  if exists (
    select 1 from public.task_group_members
    group by group_id, user_id having count(*) > 1
  ) then
    raise exception 'Duplicate task-group memberships must be resolved before applying this migration';
  end if;

  if exists (
    select 1 from public.user_site_access
    group by user_id, site_id having count(*) > 1
  ) then
    raise exception 'Duplicate site-access grants must be resolved before applying this migration';
  end if;
end $$;

create unique index if not exists user_profiles_username_ci_unique
  on public.user_profiles (lower(btrim(username)))
  where username is not null;

-- Historical duplicate claims may both represent real work (and may each have
-- tracking history), so a unique index cannot be added without discarding one
-- member's result. Keep those rows intact and give the trigger below a fast
-- lookup path instead. The trigger serializes future writes and prevents any
-- new active duplicate, including concurrent inserts.
create index if not exists member_claimed_group_day_keyword_active_idx
  on public.member_claimed_keywords (group_id, claimed_date, keyword)
  where status <> 'dismissed';

create unique index if not exists task_group_members_group_user_unique
  on public.task_group_members (group_id, user_id);

create unique index if not exists user_site_access_user_site_unique
  on public.user_site_access (user_id, site_id);

alter table public.member_claimed_keywords
  alter column group_id set not null,
  alter column user_id set not null,
  alter column keyword set not null,
  alter column claimed_date set not null,
  alter column claimed_date set default ((timezone('Asia/Kuala_Lumpur', now()))::date),
  alter column status set not null,
  alter column status set default 'pending';

alter table public.task_group_members
  alter column group_id set not null,
  alter column user_id set not null;

create or replace function public.prevent_duplicate_active_group_claim()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if new.status = 'dismissed' then
    return new;
  end if;

  -- Existing active historical duplicates are grandfathered: editing or
  -- submitting the same record must remain possible as long as its business
  -- identity does not change.
  if tg_op = 'UPDATE' then
    if old.status <> 'dismissed'
       and new.group_id is not distinct from old.group_id
       and new.claimed_date is not distinct from old.claimed_date
       and new.keyword is not distinct from old.keyword then
      return new;
    end if;
  end if;

  -- The transaction-scoped lock closes the check-then-insert race that the API
  -- alone cannot prevent. Hash collisions only serialize unrelated writes;
  -- they do not reject them.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      new.group_id::text || '|' || new.claimed_date::text || '|' || new.keyword,
      0
    )
  );

  if exists (
    select 1
    from public.member_claimed_keywords existing
    where existing.group_id = new.group_id
      and existing.claimed_date = new.claimed_date
      and existing.keyword = new.keyword
      and existing.status <> 'dismissed'
      and existing.id is distinct from new.id
  ) then
    raise exception 'An active claim already exists for this group, date, and keyword'
      using errcode = '23505';
  end if;

  return new;
end
$$;

revoke all on function public.prevent_duplicate_active_group_claim() from public;

drop trigger if exists prevent_duplicate_active_group_claim
  on public.member_claimed_keywords;
create trigger prevent_duplicate_active_group_claim
  before insert or update of group_id, claimed_date, keyword, status
  on public.member_claimed_keywords
  for each row execute function public.prevent_duplicate_active_group_claim();

create index if not exists task_group_members_user_group_idx
  on public.task_group_members (user_id, group_id);
create index if not exists user_site_access_user_site_idx
  on public.user_site_access (user_id, site_id);
create index if not exists member_claimed_group_user_date_idx
  on public.member_claimed_keywords (group_id, user_id, claimed_date desc);
create index if not exists site_tracking_records_group_claim_date_idx
  on public.site_tracking_records (group_id, claim_id, record_date desc);
create index if not exists site_tracking_rank_matches_claim_date_idx
  on public.site_tracking_rank_matches (claim_id, record_date desc);

create or replace function public.get_keyword_dates_new(p_since date)
returns table(keyword text, first_date date, last_date date)
language sql
stable
set search_path = public
as $$
  select
    rk.keyword,
    min(coalesce(rk.content_date, rk.discovered_at::date))::date,
    max(coalesce(rk.content_date, rk.discovered_at::date))::date
  from public.raw_keywords rk
  where coalesce(rk.content_date, rk.discovered_at::date) >= p_since
  group by rk.keyword
$$;

revoke all on function public.get_keyword_dates_new(date) from public;
grant execute on function public.get_keyword_dates_new(date) to authenticated, service_role;

commit;
