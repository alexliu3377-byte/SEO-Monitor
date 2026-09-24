-- Repair historical rows created before duplicate-new validation existed.
-- For one member + normalized keyword + normalized URL, the first actual
-- submission remains "新增" and every later submission becomes "更新".
begin;

create temporary table repeated_new_claims_to_reclassify
on commit drop
as
select id, group_id
from (
  select
    claim.id,
    claim.group_id,
    row_number() over (
      partition by
        claim.user_id,
        public.normalize_member_claim_keyword(claim.keyword),
        public.normalize_member_claim_url(claim.page_url)
      order by
        claim.submitted_at asc nulls last,
        claim.created_at asc nulls last,
        claim.claimed_date asc,
        claim.id asc
    ) as submission_number
  from public.member_claimed_keywords claim
  where claim.status = 'submitted'
    and claim.operation_type = '新增'
    and claim.page_url is not null
    and public.normalize_member_claim_keyword(claim.keyword) <> ''
    and public.normalize_member_claim_url(claim.page_url) <> ''
) ranked
where submission_number > 1;

update public.member_claimed_keywords claim
set operation_type = '更新'
from repeated_new_claims_to_reclassify repeated
where claim.id = repeated.id;

-- Tracking snapshots copied the operation type at collection time. Keep them
-- aligned so effectiveness scoring treats the repaired rows as updates too.
update public.site_tracking_records tracking
set operation_type = '更新'
from repeated_new_claims_to_reclassify repeated
where tracking.claim_id = repeated.id;

-- These tables are derived data. Remove only affected groups so the next
-- report request (or scheduled refresh) rebuilds scores with the repaired type.
delete from public.group_tracking_cache_rows cache_row
using (
  select distinct group_id
  from repeated_new_claims_to_reclassify
  where group_id is not null
) affected
where cache_row.group_id = affected.group_id;

delete from public.group_tracking_cache_state cache_state
using (
  select distinct group_id
  from repeated_new_claims_to_reclassify
  where group_id is not null
) affected
where cache_state.group_id = affected.group_id;

delete from public.group_tracking_cache cache
using (
  select distinct group_id
  from repeated_new_claims_to_reclassify
  where group_id is not null
) affected
where cache.group_id = affected.group_id;

commit;
