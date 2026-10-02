-- Owner-only keyword classification workspace. API authorization is enforced
-- server-side; these columns store Codex batch classifications and later manual corrections.
alter table public.keyword_volume
  add column if not exists content_category text,
  add column if not exists content_subcategory text,
  add column if not exists classification_status text not null default 'pending',
  add column if not exists classification_source text,
  add column if not exists classification_confidence numeric(4, 3),
  add column if not exists classification_reason text,
  add column if not exists classification_model text,
  add column if not exists classification_batch_id uuid,
  add column if not exists classification_queued_at timestamptz not null default now(),
  add column if not exists classified_at timestamptz,
  add column if not exists reviewed_at timestamptz;

alter table public.keyword_volume drop constraint if exists keyword_volume_classification_status_check;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'keyword_volume_content_category_check') then
    alter table public.keyword_volume add constraint keyword_volume_content_category_check
      check (content_category is null or content_category in ('游戏', '应用', '专题', '资讯', '排行榜', '-'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'keyword_volume_classification_status_check') then
    alter table public.keyword_volume add constraint keyword_volume_classification_status_check
      check (classification_status in ('pending', 'processing', 'confirmed'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'keyword_volume_classification_source_check') then
    alter table public.keyword_volume add constraint keyword_volume_classification_source_check
      check (classification_source is null or classification_source in ('codex', 'manual'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'keyword_volume_classification_confidence_check') then
    alter table public.keyword_volume add constraint keyword_volume_classification_confidence_check
      check (classification_confidence is null or (classification_confidence >= 0 and classification_confidence <= 1));
  end if;
end $$;

create index if not exists idx_keyword_volume_classification_queue
  on public.keyword_volume (classification_status, classification_queued_at desc, volume desc);
create index if not exists idx_keyword_volume_classification_batch
  on public.keyword_volume (classification_batch_id)
  where classification_batch_id is not null;
create index if not exists idx_keyword_volume_content_category
  on public.keyword_volume (content_category, content_subcategory, volume desc);

create table if not exists public.keyword_classification_batches (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'running' check (status in ('running', 'completed', 'failed')),
  requested_count integer not null default 0,
  saved_count integer not null default 0,
  model text not null default 'Codex',
  error_message text,
  started_at timestamptz not null default now(),
  completed_at timestamptz
);

alter table public.keyword_classification_batches enable row level security;

drop function if exists public.keyword_classification_summary();
create function public.keyword_classification_summary()
returns table(
  category text,
  subcategory text,
  status text,
  source text,
  keyword_count bigint,
  total_volume bigint,
  rising_count bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    case
      when classification_status in ('pending', 'processing') then '待分类'
      when content_category is null then '-'
      else content_category
    end as category,
    case when classification_status in ('pending', 'processing') then null else content_subcategory end as subcategory,
    case when classification_status = 'processing' then 'pending' else classification_status end as status,
    case when classification_status in ('pending', 'processing') then null else classification_source end as source,
    count(*)::bigint as keyword_count,
    coalesce(sum(volume), 0)::bigint as total_volume,
    count(*) filter (where coalesce(net_volume_change, 0) > 0)::bigint as rising_count
  from public.keyword_volume
  group by 1, 2, 3, 4;
$$;

revoke all on function public.keyword_classification_summary() from public;
grant execute on function public.keyword_classification_summary() to service_role;

create or replace function public.apply_keyword_codex_classifications(p_items jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  changed integer;
begin
  update public.keyword_volume kv
  set content_category = item.category,
      content_subcategory = nullif(item.subcategory, ''),
      classification_status = 'confirmed',
      classification_source = 'codex',
      classification_confidence = greatest(0, least(1, item.confidence)),
      classification_reason = left(item.reason, 300),
      classification_model = coalesce(nullif(item.model, ''), 'Codex'),
      classification_batch_id = null,
      classified_at = now()
  from jsonb_to_recordset(coalesce(p_items, '[]'::jsonb)) as item(
    keyword text,
    category text,
    subcategory text,
    confidence numeric,
    reason text,
    model text
  )
  where kv.keyword = item.keyword
    and kv.classification_status in ('pending', 'processing');
  get diagnostics changed = row_count;
  return changed;
end;
$$;

revoke all on function public.apply_keyword_codex_classifications(jsonb) from public;
grant execute on function public.apply_keyword_codex_classifications(jsonb) to service_role;

create or replace function public.claim_keyword_classification_batch(p_batch_id uuid, p_limit integer)
returns table(keyword text, volume integer)
language sql
security definer
set search_path = public
as $$
  with candidates as (
    select kv.keyword
    from public.keyword_volume kv
    where kv.classification_status = 'pending'
    order by kv.volume desc, kv.keyword
    for update skip locked
    limit greatest(1, least(coalesce(p_limit, 500), 2000))
  )
  update public.keyword_volume kv
  set classification_status = 'processing',
      classification_batch_id = p_batch_id
  from candidates
  where kv.keyword = candidates.keyword
  returning kv.keyword, kv.volume;
$$;

revoke all on function public.claim_keyword_classification_batch(uuid, integer) from public;
grant execute on function public.claim_keyword_classification_batch(uuid, integer) to service_role;

create or replace function public.release_keyword_classification_batch(p_batch_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  changed integer;
begin
  update public.keyword_volume
  set classification_status = 'pending',
      classification_batch_id = null
  where classification_batch_id = p_batch_id
    and classification_status = 'processing';
  get diagnostics changed = row_count;
  return changed;
end;
$$;

revoke all on function public.release_keyword_classification_batch(uuid) from public;
grant execute on function public.release_keyword_classification_batch(uuid) to service_role;
