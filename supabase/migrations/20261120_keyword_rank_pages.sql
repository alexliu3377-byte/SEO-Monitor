-- 词 → 竞品下载站页面（2026-11-20，负责人要求）：每个已确认分类的游戏 / 应用词，提前算好最近 30 天排名表里
-- 的前几个页面链接（带标题），给奇心 Agent 的「排名词」接口和词库补充页的「导出词和链接」用，不用每次现算。
--
-- 怎么刷新：每天排名抓取（daily-crawl.yml 的 rank-title 步骤）结束后、补录爱站 Excel 后，
-- scripts/refresh-keyword-rank-pages.ts 按词分批调用 refresh_keyword_rank_pages（每批最多 5000 个词，按词名往后翻），
-- 全部批次成功后调用 finish_keyword_rank_pages 删掉这一轮没再出现的词（分类改了、不再是已确认的游戏 / 应用词）。
-- 中途失败不删旧数据，表里留着上一轮的结果。
--
-- 整理规则和 lib/agent-ranked-pages.ts 的 pickPages 一致：
--   同一页（去掉 www./m./wap. 和末尾斜杠，不看 ? 后面）只留一个，有电脑版地址时留电脑版；wap. 开头的不要；
--   同一个站、标题一样的只留排名最好的；标题里带这个词的排前，其次排名靠前、日期新；
--   每个站先出一个页面，凑不够再补同站的；最多 p_max 个（默认 5）。
--
-- 只新增一张表和两个函数，不改、不删已有表和数据。重复执行安全（create if not exists / create or replace）。
begin;

create table if not exists public.keyword_rank_pages (
  keyword text primary key,
  content_category text not null,
  content_subcategory text,
  volume integer,
  page_count smallint not null default 0,
  pages jsonb not null default '[]'::jsonb,
  refreshed_at timestamptz not null default now(),
  constraint keyword_rank_pages_category_check check (content_category in ('游戏', '应用')),
  constraint keyword_rank_pages_pages_check check (jsonb_typeof(pages) = 'array' and page_count between 0 and 10)
);
create index if not exists keyword_rank_pages_volume_idx on public.keyword_rank_pages (volume desc, keyword);

-- 只给服务端用（service_role）：浏览器端的 anon / authenticated 不能直接读写，页面一律走有权限检查的接口。
alter table public.keyword_rank_pages enable row level security;
revoke all on table public.keyword_rank_pages from public, anon, authenticated;
grant select, insert, update, delete on table public.keyword_rank_pages to service_role;

create or replace function public.refresh_keyword_rank_pages(
  p_after text default null,
  p_limit integer default 2000,
  p_days integer default 30,
  p_max integer default 5,
  p_run timestamptz default now()
) returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 2000), 1), 5000);
  v_days integer := least(greatest(coalesce(p_days, 30), 1), 40);
  v_max integer := least(greatest(coalesce(p_max, 5), 1), 10);
  v_run timestamptz := coalesce(p_run, now());
  v_since date := (now() at time zone 'Asia/Kuala_Lumpur')::date - v_days;
  v_words integer := 0;
  v_with integer := 0;
  v_last text;
begin
  with words as (
    select distinct on (kv.keyword) kv.keyword, kv.volume, kv.content_category, kv.content_subcategory
    from keyword_volume kv
    where kv.classification_status = 'confirmed'
      and kv.content_category in ('游戏', '应用')
      and kv.volume > 0
      and (p_after is null or kv.keyword > p_after)
    order by kv.keyword, kv.stat_date desc
    limit v_limit
  ),
  site_domains as (
    select s.id,
      regexp_replace(regexp_replace(regexp_replace(lower(btrim(s.domain)), '^https?://', ''), '^(www|m|wap)\.', ''), '/.*$', '') as domain
    from sites s
  ),
  raw as (
    select r.keyword, r.site_id, btrim(r.url) as url, r.rank_position, r.stat_date,
      left(btrim(regexp_replace(coalesce(r.title, ''), '\s+', ' ', 'g')), 100) as title,
      regexp_match(btrim(r.url), '^https?://([^/?#]+)([^?#]*)', 'i') as m
    from site_keyword_ranks r
    join words w on w.keyword = r.keyword
    where r.url is not null and r.stat_date >= v_since
  ),
  parsed as (
    select keyword, site_id, url, rank_position, stat_date, title,
      lower(regexp_replace(regexp_replace(m[1], '^.*@', ''), ':[0-9]*$', '')) as hostname,
      coalesce(m[2], '') as path
    from raw
    where m is not null
  ),
  keyed as (
    select p.*,
      regexp_replace(p.hostname, '^(www|m|wap)\.', '') as host,
      regexp_replace(p.hostname, '^(www|m|wap)\.', '') || regexp_replace(p.path, '/+$', '') as page_key,
      p.hostname ~ '^(m|3g|h5|mobile)\.' as mobile
    from parsed p
    where p.hostname !~ '^wap\.'
      and regexp_replace(p.hostname, '^(www|m|wap)\.', '') like '%.%'
  ),
  -- 同一页合并：地址优先电脑版（最新的那个），标题用最新的，排名取最好的，日期取最新的。
  merged as (
    select k.keyword, k.page_key,
      (array_agg(k.url order by k.mobile, k.stat_date desc, k.url))[1] as url,
      (array_agg(k.title order by (k.title = ''), k.stat_date desc, k.url))[1] as title,
      (array_agg(k.site_id order by k.stat_date desc, k.url))[1] as site_id,
      (array_agg(k.host order by k.stat_date desc, k.url))[1] as host,
      min(k.rank_position) filter (where k.rank_position > 0) as rank,
      max(k.stat_date) as date
    from keyed k
    group by k.keyword, k.page_key
  ),
  -- 同一个站、标题一样的当作同一页，只留排名最好的。
  titled as (
    select m.*,
      lower(regexp_replace(normalize(m.title, NFKC), '\s+', '', 'g')) as title_norm
    from merged m
  ),
  deduped as (
    select distinct on (t.keyword, t.site_id, case when t.title <> '' then t.title_norm else t.url end) t.*
    from titled t
    order by t.keyword, t.site_id, case when t.title <> '' then t.title_norm else t.url end, coalesce(t.rank, 999), t.date desc, t.url
  ),
  ordered as (
    select d.*,
      row_number() over (partition by d.keyword order by
        (position(lower(regexp_replace(normalize(d.keyword, NFKC), '\s+', '', 'g')) in d.title_norm) > 0) desc,
        coalesce(d.rank, 999), d.date desc, d.url) as sort_pos
    from deduped d
  ),
  site_ranked as (
    select o.*, row_number() over (partition by o.keyword, o.site_id order by o.sort_pos) as site_pos
    from ordered o
  ),
  picked as (
    select s.*, row_number() over (partition by s.keyword order by (s.site_pos > 1), s.sort_pos) as out_pos
    from site_ranked s
  ),
  agg as (
    select p.keyword, count(*)::smallint as page_count,
      jsonb_agg(jsonb_build_object(
        'url', p.url,
        'title', p.title,
        'site', coalesce(nullif(sd.domain, ''), p.host),
        'rank', p.rank,
        'date', to_char(p.date, 'YYYY-MM-DD')
      ) order by p.out_pos) as pages
    from picked p
    left join site_domains sd on sd.id = p.site_id
    where p.out_pos <= v_max
    group by p.keyword
  ),
  upserted as (
    insert into keyword_rank_pages as t (keyword, content_category, content_subcategory, volume, page_count, pages, refreshed_at)
    select w.keyword, w.content_category, w.content_subcategory, w.volume,
      coalesce(a.page_count, 0), coalesce(a.pages, '[]'::jsonb), v_run
    from words w
    left join agg a on a.keyword = w.keyword
    on conflict (keyword) do update set
      content_category = excluded.content_category,
      content_subcategory = excluded.content_subcategory,
      volume = excluded.volume,
      page_count = excluded.page_count,
      pages = excluded.pages,
      refreshed_at = excluded.refreshed_at
    returning t.keyword, t.page_count
  )
  select count(*)::integer, (count(*) filter (where page_count > 0))::integer, max(keyword)
  into v_words, v_with, v_last
  from upserted;

  return jsonb_build_object('words', v_words, 'with_pages', v_with, 'last_keyword', v_last, 'done', v_words < v_limit);
end;
$$;

-- 全部批次成功后才调用：删掉这一轮没有刷新到的词（p_run 之前的）。
create or replace function public.finish_keyword_rank_pages(p_run timestamptz)
returns integer
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_deleted integer := 0;
begin
  if p_run is null then
    raise exception 'p_run is required';
  end if;
  delete from keyword_rank_pages where refreshed_at < p_run;
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function public.refresh_keyword_rank_pages(text, integer, integer, integer, timestamptz) from public, anon, authenticated;
revoke all on function public.finish_keyword_rank_pages(timestamptz) from public, anon, authenticated;
grant execute on function public.refresh_keyword_rank_pages(text, integer, integer, integer, timestamptz) to service_role;
grant execute on function public.finish_keyword_rank_pages(timestamptz) to service_role;

commit;
