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
] as const

export function allowsServiceAuthPath(pathname: string): boolean {
  return SERVICE_AUTH_PATHS.some(path => pathname === path || pathname.startsWith(`${path}/`))
}
