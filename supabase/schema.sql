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

CREATE OR REPLACE FUNCTION monthly_continuous_trend(p_start date, p_end date, p_limit int DEFAULT 100)
RETURNS TABLE(keyword text, domain text, type text, volume bigint, streak bigint, dates date[])
LANGUAGE sql STABLE AS $$
  SELECT rc.keyword, s.domain, rc.type, MAX(rc.volume)::bigint AS volume,
    COUNT(DISTINCT rc.stat_date)::bigint AS streak,
    ARRAY_AGG(DISTINCT rc.stat_date ORDER BY rc.stat_date) AS dates
  FROM rank_changes rc
  JOIN sites s ON s.id = rc.site_id
  WHERE rc.stat_date >= p_start AND rc.stat_date <= p_end AND rc.type IN ('rankup', 'rankdown')
  GROUP BY rc.keyword, rc.site_id, s.domain, rc.type
  HAVING COUNT(DISTINCT rc.stat_date) >= 2
  ORDER BY streak DESC, volume DESC
  LIMIT p_limit
$$;

CREATE OR REPLACE FUNCTION monthly_new_keyword_top(p_start date, p_end date, p_content_type text, p_limit int DEFAULT 50)
RETURNS TABLE(keyword text, volume bigint)
LANGUAGE sql STABLE AS $$
  SELECT rk.keyword, COALESCE(MAX(kv.volume), 0)::bigint AS volume
  FROM (SELECT DISTINCT keyword FROM raw_keywords WHERE content_date >= p_start AND content_date <= p_end AND content_type = p_content_type) rk
  LEFT JOIN keyword_volume kv ON kv.keyword = rk.keyword
  GROUP BY rk.keyword
  ORDER BY volume DESC
  LIMIT p_limit
$$;

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
