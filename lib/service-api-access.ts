const SERVICE_AUTH_PATHS = [
  '/api/cron',
  '/api/environment/daily-snapshot',
  '/api/hot-radar/refresh',
  '/api/charts/monthly-trend',
  '/api/content-feed/ingest',
  '/api/charts/douyin-minigames/ingest',
  '/api/charts/game-discovery/ingest',
  '/api/content-feed/refresh',
  '/api/content-feed/transcripts/claim',
  '/api/content-feed/transcripts/result',
  '/api/tracking-cache/refresh',
  // 奇心 Agent 推荐词（只读，专用密钥 AGENT_WORD_FEED_SECRET）
  '/api/agent/word-feed',
] as const

export function allowsServiceAuthPath(pathname: string): boolean {
  return SERVICE_AUTH_PATHS.some(path => pathname === path || pathname.startsWith(`${path}/`))
}
