-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Sites table
CREATE TABLE IF NOT EXISTS sites (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  domain TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('large', 'medium', 'small')),
  crawl_type TEXT NOT NULL CHECK (crawl_type IN ('sitemap', 'html', 'rss')),
  list_url TEXT,
  title_selector TEXT,
  date_selector TEXT,
  source_types TEXT,
  crawl_frequency TEXT NOT NULL DEFAULT 'daily' CHECK (crawl_frequency IN ('daily', 'every3days', 'weekly')),
  enable_version_clean BOOLEAN NOT NULL DEFAULT FALSE,
  version_suffixes TEXT[] DEFAULT '{}',
  is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sites_domain ON sites(domain);
CREATE INDEX IF NOT EXISTS idx_sites_is_enabled ON sites(is_enabled);
CREATE INDEX IF NOT EXISTS idx_sites_category ON sites(category);

-- Raw keywords table (auto-delete after 30 days)
CREATE TABLE IF NOT EXISTS raw_keywords (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  keyword TEXT NOT NULL,
  site_id UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  source_url TEXT,
  discovered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  content_type TEXT NOT NULL DEFAULT 'app',
  content_date DATE
);

CREATE INDEX IF NOT EXISTS idx_raw_keywords_site_id ON raw_keywords(site_id);
CREATE INDEX IF NOT EXISTS idx_raw_keywords_discovered_at ON raw_keywords(discovered_at);
CREATE INDEX IF NOT EXISTS idx_raw_keywords_keyword ON raw_keywords(keyword);
CREATE INDEX IF NOT EXISTS idx_raw_keywords_content_date ON raw_keywords(content_date);
CREATE UNIQUE INDEX IF NOT EXISTS uq_raw_keywords_site_date_kw ON raw_keywords(site_id, content_date, keyword) WHERE content_date IS NOT NULL;

-- 2026-08-05: raw_keywords 改成永久保留（同一关键词隔很久再出现要能靠历史记录
-- 判断成"之前见过的"而不是又算一次新增），app 代码不再调用这个函数，函数本身
-- 留着没删，如果以后想恢复自动清理可以重新调用它。
-- Function to auto-delete raw_keywords older than 30 days
CREATE OR REPLACE FUNCTION delete_old_raw_keywords()
RETURNS void AS $$
BEGIN
  DELETE FROM raw_keywords WHERE discovered_at < NOW() - INTERVAL '30 days';
END;
$$ LANGUAGE plpgsql;

-- Daily stats table (permanent)
-- Index snapshots table (permanent)
CREATE TABLE IF NOT EXISTS index_snapshots (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  site_id UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  snapshot_date DATE NOT NULL DEFAULT CURRENT_DATE,
  index_count INTEGER NOT NULL DEFAULT 0,
  UNIQUE(site_id, snapshot_date)
);

CREATE INDEX IF NOT EXISTS idx_index_snapshots_site_id ON index_snapshots(site_id);
CREATE INDEX IF NOT EXISTS idx_index_snapshots_snapshot_date ON index_snapshots(snapshot_date);

-- Keyword volume table (permanent, one record per keyword)
CREATE TABLE IF NOT EXISTS keyword_volume (
  keyword TEXT    PRIMARY KEY,
  volume  INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_keyword_volume_volume ON keyword_volume(volume DESC);

-- Weight history table (permanent)
CREATE TABLE IF NOT EXISTS weight_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  site_id UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  record_date DATE NOT NULL DEFAULT CURRENT_DATE,
  pc_weight INTEGER NOT NULL DEFAULT 0,
  mobile_weight INTEGER NOT NULL DEFAULT 0,
  UNIQUE(site_id, record_date)
);

CREATE INDEX IF NOT EXISTS idx_weight_history_site_id ON weight_history(site_id);
CREATE INDEX IF NOT EXISTS idx_weight_history_record_date ON weight_history(record_date);

-- Optional: create a scheduled job using pg_cron (if available)
-- SELECT cron.schedule('0 2 * * *', $$SELECT delete_old_raw_keywords()$$);
-- SELECT cron.schedule('0 3 * * *', $$SELECT delete_old_hot_keywords()$$);

-- RPC: 热词雷达 — 连续上涨词（按 site×keyword 聚合 rankup 天数）
-- 在 Supabase SQL Editor 执行：
CREATE OR REPLACE FUNCTION get_hot_streak_words(p_since date)
RETURNS TABLE(
  keyword    text,
  domain     text,
  streak     bigint,
  volume     bigint,
  first_seen date,
  last_seen  date
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    rc.keyword,
    s.domain,
    COUNT(DISTINCT rc.stat_date)  AS streak,
    MAX(rc.volume)::bigint        AS volume,
    MIN(rc.stat_date)             AS first_seen,
    MAX(rc.stat_date)             AS last_seen
  FROM rank_changes rc
  JOIN sites s ON s.id = rc.site_id
  WHERE rc.type = 'rankup'
    AND rc.stat_date >= p_since
  GROUP BY rc.keyword, rc.site_id, s.domain
  HAVING COUNT(DISTINCT rc.stat_date) >= 2
  ORDER BY last_seen DESC, streak DESC, volume DESC
$$;

-- 热词雷达：各 tab 关键词日期聚合（在 Supabase SQL Editor 执行）
-- get_keyword_dates_new: raw_keywords 30天自动删，无需日期过滤；content_date NULL 时用 discovered_at 兜底
DROP FUNCTION IF EXISTS get_keyword_dates_new(date);
CREATE OR REPLACE FUNCTION get_keyword_dates_new(p_since date)
RETURNS TABLE(keyword text, first_date date, last_date date)
LANGUAGE sql STABLE AS $$
  SELECT keyword,
    MIN(COALESCE(content_date, discovered_at::date))::date,
    MAX(COALESCE(content_date, discovered_at::date))::date
  FROM raw_keywords
  GROUP BY keyword
$$;

-- 规则中心·月度趋势下钻——聚合放在SQL里做（不像最初实现那样把整月几十万行
-- rank_changes 拉到 Node 里再聚合，2026-08-06 实测一个月81万行光拉数据+分页
-- 就要将近30秒）。以下三个函数配合 monthly_trend_cache 表使用：过去的月份
-- （非当月）算完一次就存进缓存表，之后同一个月直接读缓存，不用重算；只有
-- 还在变动的当月每次都会重新调这几个函数（现在很快，不再是瓶颈）。
CREATE INDEX IF NOT EXISTS idx_rank_changes_stat_date ON rank_changes(stat_date);

CREATE OR REPLACE FUNCTION monthly_rank_change_top(p_start date, p_end date, p_type text, p_limit int DEFAULT 100)
RETURNS TABLE(keyword text, volume bigint, domains text[])
LANGUAGE sql STABLE AS $$
  SELECT rc.keyword, MAX(rc.volume)::bigint AS volume, ARRAY_AGG(DISTINCT s.domain) AS domains
  FROM rank_changes rc
  JOIN sites s ON s.id = rc.site_id
  WHERE rc.stat_date >= p_start AND rc.stat_date <= p_end AND rc.type = p_type
  GROUP BY rc.keyword
  ORDER BY volume DESC
  LIMIT p_limit
$$;

-- 2026-08-10：原本按(keyword,site_id,type)分组，同一个词在不同站点各出一行——
-- 用户反馈同一个词跨站点重复出现在列表里很乱（比如"华为应用商店下载"在两个站
-- 都连续涨，列表里会看到两条一模一样的）。改成只按(keyword,type)分组，展示
-- 这个词在所有站点里最高的连续天数，"查看"时才展开前5名站点各自的连续天数
-- （sites jsonb 数组），不是简单罗列域名。
DROP FUNCTION IF EXISTS monthly_continuous_trend(date, date, integer);
CREATE OR REPLACE FUNCTION monthly_continuous_trend(p_start date, p_end date, p_limit int DEFAULT 100)
RETURNS TABLE(keyword text, type text, volume bigint, streak bigint, site_count bigint, sites jsonb)
LANGUAGE sql STABLE AS $$
  WITH per_site AS (
    SELECT rc.keyword, rc.type, s.domain,
      MAX(rc.volume)::bigint AS volume,
      COUNT(DISTINCT rc.stat_date)::bigint AS streak,
      ARRAY_AGG(DISTINCT rc.stat_date ORDER BY rc.stat_date) AS dates
    FROM rank_changes rc
    JOIN sites s ON s.id = rc.site_id
    WHERE rc.stat_date >= p_start AND rc.stat_date <= p_end AND rc.type IN ('rankup', 'rankdown')
    GROUP BY rc.keyword, rc.site_id, s.domain, rc.type
    HAVING COUNT(DISTINCT rc.stat_date) >= 2
  ),
  ranked AS (
    SELECT *, ROW_NUMBER() OVER (PARTITION BY keyword, type ORDER BY streak DESC, volume DESC) AS rn
    FROM per_site
  )
  SELECT
    keyword, type,
    MAX(volume)::bigint AS volume,
    MAX(streak)::bigint AS streak,
    COUNT(*)::bigint AS site_count,
    JSONB_AGG(JSONB_BUILD_OBJECT('domain', domain, 'streak', streak, 'volume', volume, 'dates', dates) ORDER BY streak DESC, volume DESC) FILTER (WHERE rn <= 5) AS sites
  FROM ranked
  GROUP BY keyword, type
  ORDER BY streak DESC, volume DESC
  LIMIT p_limit
$$;

-- 2026-08-06 加 domains——用户要"热门新增词"也能点"查看"知道是哪些站贡献的，
-- 跟涨跌词一样。先按关键词把 raw_keywords 聚成"哪些站有过这个词"（不用先
-- DISTINCT keyword 再关联了，因为要保留 site_id 才能算 domains），再单独去
-- 关联 keyword_volume 拿搜索量——分两段避免 keyword_volume 的多行历史把
-- 中间结果行数搞爆。返回类型变了（多了 domains），CREATE OR REPLACE 换不了
-- 返回列，必须先 DROP。
DROP FUNCTION IF EXISTS monthly_new_keyword_top(date, date, text, integer);
CREATE OR REPLACE FUNCTION monthly_new_keyword_top(p_start date, p_end date, p_content_type text, p_limit int DEFAULT 50)
RETURNS TABLE(keyword text, volume bigint, domains text[])
LANGUAGE sql STABLE AS $$
  WITH kw AS (
    SELECT rk.keyword, ARRAY_AGG(DISTINCT s.domain) AS domains
    FROM raw_keywords rk
    JOIN sites s ON s.id = rk.site_id
    WHERE rk.content_date >= p_start AND rk.content_date <= p_end AND rk.content_type = p_content_type
    GROUP BY rk.keyword
  )
  SELECT kw.keyword, COALESCE(MAX(kv.volume), 0)::bigint AS volume, kw.domains
  FROM kw
  LEFT JOIN keyword_volume kv ON kv.keyword = kw.keyword
  GROUP BY kw.keyword, kw.domains
  -- "热门"新增词按有多少个站独立新增了这个词排（多个站不约而同都在加同一个词，
  -- 才是真正的"趋势"信号；搜索量高但只有一个站在做，说明不了"大家都在跟这个"）。
  -- 搜索量当第二排序，同样站数的词再比谁的搜索需求更大。
  ORDER BY ARRAY_LENGTH(kw.domains, 1) DESC, volume DESC
  LIMIT p_limit
$$;

-- 搜索量变动——跟分组任务"搜索量上涨"tab同一个数据源（keyword_volume 只存
-- 每个关键词当前一行，volume_change 是相对上次抓取的变化量），范围限定在
-- "这个月 rank_changes 里出现过的关键词"（不是全局所有关键词，否则跟这个月
-- 没关系的词也会混进来）。up/down 一起返回（避免再扫一次 rank_changes），
-- 按变化幅度绝对值排序取前 p_limit 条，前端再按正负拆成两栏。
-- 2026-08-06：一开始写成"先 DISTINCT keyword+site_id 出一个月的关键词全集，
-- 再关联 sites 算 domains"两段式CTE，实测比其它三个同样扫 rank_changes 整月
-- 的RPC明显慢，单独跑都会 statement timeout——多一次 DISTINCT 排序/去重的
-- 代价比想象中大。改成跟其它RPC一样的单阶段写法（JOIN 完直接 GROUP BY 一次
-- 出 domains），标准 hash aggregate 一次搞定，不再单独 DISTINCT。
CREATE OR REPLACE FUNCTION monthly_volume_change_top(p_start date, p_end date, p_limit int DEFAULT 300)
RETURNS TABLE(keyword text, volume bigint, volume_change bigint, domains text[])
LANGUAGE sql STABLE AS $$
  WITH kw_domains AS (
    SELECT rc.keyword, ARRAY_AGG(DISTINCT s.domain) AS domains
    FROM rank_changes rc
    JOIN sites s ON s.id = rc.site_id
    WHERE rc.stat_date >= p_start AND rc.stat_date <= p_end
    GROUP BY rc.keyword
  )
  SELECT kv.keyword, kv.volume::bigint, kv.volume_change::bigint, kd.domains
  FROM keyword_volume kv
  JOIN kw_domains kd ON kd.keyword = kv.keyword
  WHERE kv.volume_change != 0
  ORDER BY ABS(kv.volume_change) DESC
  LIMIT p_limit
$$;

-- 这四个月度趋势RPC整月扫 rank_changes/raw_keywords，正常都要跑7-10秒，
-- 卡在这个项目默认 statement_timeout（约8-9秒）的边缘——2026-08-06 实测
-- monthly_volume_change_top 好几次直接因为超时失败。这几个函数本来就是
-- 人工点开月度趋势某个月才会触发一次的重查询，不是高频接口，单独给它们
-- 放宽超时到30秒（只影响这四个函数，不改全局/其它查询的超时）。
ALTER FUNCTION monthly_rank_change_top(date, date, text, integer) SET statement_timeout = '30s';
ALTER FUNCTION monthly_continuous_trend(date, date, integer) SET statement_timeout = '30s';
ALTER FUNCTION monthly_new_keyword_top(date, date, text, integer) SET statement_timeout = '30s';
ALTER FUNCTION monthly_volume_change_top(date, date, integer) SET statement_timeout = '30s';

-- 月度趋势下钻结果缓存——月份是主键，已经关闭的月份（不是当月）算完一次就
-- 写进来，下次同一个月直接读这张表，不重新聚合。
CREATE TABLE IF NOT EXISTS monthly_trend_cache (
  month       TEXT PRIMARY KEY,
  payload     JSONB NOT NULL,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- get_hot_rank_words 含 rank_days（涨排次数 = 不同日期数）
-- DROP FUNCTION get_hot_rank_words(text);
-- CREATE FUNCTION public.get_hot_rank_words(p_since text)
-- RETURNS TABLE(keyword text, site_count bigint, max_volume bigint, sites text[], first_date date, last_date date, rank_days bigint)
-- LANGUAGE sql SECURITY DEFINER AS $function$
--   SELECT rc.keyword, COUNT(DISTINCT rc.site_id), MAX(COALESCE(rc.volume,0)),
--     ARRAY_AGG(DISTINCT s.domain), MIN(rc.stat_date)::date, MAX(rc.stat_date)::date,
--     COUNT(DISTINCT rc.stat_date)
--   FROM rank_changes rc JOIN sites s ON s.id=rc.site_id
--   WHERE rc.type='rankup' AND rc.stat_date>=p_since::date
--   GROUP BY rc.keyword HAVING COUNT(DISTINCT rc.site_id)>=2
--   ORDER BY site_count DESC, max_volume DESC;
-- $function$

-- 分组任务 tables
CREATE TABLE IF NOT EXISTS task_groups (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name         TEXT NOT NULL,
  type         TEXT NOT NULL DEFAULT 'both' CHECK (type IN ('game', 'app', 'both')),
  rank_domains TEXT[] NOT NULL DEFAULT '{}',
  new_domains  TEXT[] NOT NULL DEFAULT '{}',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS task_group_members (
  group_id  UUID NOT NULL REFERENCES task_groups(id) ON DELETE CASCADE,
  user_id   UUID NOT NULL,
  username  TEXT,
  PRIMARY KEY (group_id, user_id)
);
