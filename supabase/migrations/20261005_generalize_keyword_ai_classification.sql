-- 日常新增词由可替换的 AI 提供方处理，不再把来源固定写成 Codex。
alter table public.keyword_volume
  drop constraint if exists keyword_volume_classification_source_check;

alter table public.keyword_volume
  add constraint keyword_volume_classification_source_check
  check (classification_source is null or classification_source in ('ai', 'codex', 'manual'));

create or replace function public.apply_keyword_ai_classifications(p_items jsonb)
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
      classification_source = case when item.source in ('ai', 'codex') then item.source else 'ai' end,
      classification_confidence = greatest(0, least(1, item.confidence)),
      classification_reason = left(item.reason, 300),
      classification_model = coalesce(nullif(item.model, ''), '自动分类'),
      classification_batch_id = null,
      classified_at = now()
  from jsonb_to_recordset(coalesce(p_items, '[]'::jsonb)) as item(
    keyword text,
    category text,
    subcategory text,
    confidence numeric,
    reason text,
    model text,
    source text
  )
  where kv.keyword = item.keyword
    and kv.classification_status in ('pending', 'processing');
  get diagnostics changed = row_count;
  return changed;
end;
$$;

revoke all on function public.apply_keyword_ai_classifications(jsonb) from public, anon, authenticated;
grant execute on function public.apply_keyword_ai_classifications(jsonb) to service_role;
