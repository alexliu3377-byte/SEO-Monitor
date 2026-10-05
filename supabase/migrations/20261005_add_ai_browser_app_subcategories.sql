-- 用关键词和现有 Codex 判断依据识别应用二级分类；浏览器比 AI 工具优先。
with source as (
  select
    keyword,
    lower(coalesce(keyword, '') || ' ' || coalesce(classification_reason, '')) as search_text
  from public.keyword_volume
  where content_category = '应用'
), browser_updated as (
  update public.keyword_volume target
  set content_subcategory = '浏览器'
  from source
  where target.keyword = source.keyword
    and source.search_text ~ '(浏览器|browser|chrome|safari|firefox|火狐|microsoft[[:space:]]*edge|微软[[:space:]]*edge|edge浏览器|uc浏览器|夸克浏览器|欧朋浏览器|(^|[^a-z])opera([^a-z]|$))'
    and target.content_subcategory is distinct from '浏览器'
  returning target.keyword
), ai_updated as (
  update public.keyword_volume target
  set content_subcategory = 'AI工具'
  from source
  where target.keyword = source.keyword
    and source.search_text !~ '(浏览器|browser|chrome|safari|firefox|火狐|microsoft[[:space:]]*edge|微软[[:space:]]*edge|edge浏览器|uc浏览器|夸克浏览器|欧朋浏览器|(^|[^a-z])opera([^a-z]|$))'
    and source.search_text ~ '(人工智能|ai工具|ai助手|ai软件|ai写作|ai绘画|ai聊天|chatgpt|deepseek|豆包|文心一言|通义千问|千问|kimi|claude|gemini|copilot|codex|讯飞星火|天工ai|秘塔ai|智谱清言|(^|[^a-z])ai([^a-z]|$))'
    and target.content_subcategory is distinct from 'AI工具'
  returning target.keyword
)
select
  (select count(*) from browser_updated) as browser_updated_count,
  (select count(*) from ai_updated) as ai_updated_count;
