-- 排行榜只保留明确包含限定榜单表达的关键词；其余旧资料统一归入专题。
with updated as (
update public.keyword_volume
set
  content_category = '专题',
  content_subcategory = null,
  classification_reason = '未命中排行榜限定词，按规则归为专题',
  classified_at = now()
where content_category = '排行榜'
  and not (
    regexp_replace(keyword, '[[:space:]]+', '', 'g') like '%排行榜%'
    or regexp_replace(keyword, '[[:space:]]+', '', 'g') like '%榜单%'
    or regexp_replace(keyword, '[[:space:]]+', '', 'g') like '%前10%'
    or regexp_replace(keyword, '[[:space:]]+', '', 'g') like '%前十%'
    or regexp_replace(keyword, '[[:space:]]+', '', 'g') like '%前20%'
    or regexp_replace(keyword, '[[:space:]]+', '', 'g') like '%前二十%'
    or regexp_replace(keyword, '[[:space:]]+', '', 'g') like '%十大%'
    or regexp_replace(keyword, '[[:space:]]+', '', 'g') like '%10大%'
  )
returning keyword
)
select count(*) as reclassified_count from updated;
