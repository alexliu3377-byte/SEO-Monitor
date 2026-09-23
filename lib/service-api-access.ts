const SERVICE_AUTH_PATHS = [
  '/api/cron',
  '/api/environment/daily-snapshot',
  '/api/hot-radar/refresh',
  '/api/tracking-cache/refresh',
  '/api/trend-discovery/ingest',
  '/api/trend-discovery/collector-config',
  '/api/trend-discovery/claim',
] as const

export function allowsServiceAuthPath(pathname: string): boolean {
  return SERVICE_AUTH_PATHS.some(path => pathname === path || pathname.startsWith(`${path}/`))
}
