export const CONTENT_SYSTEM_ROOT = '/content'
export const APP_UPDATE_SYSTEM_ROOT = '/app-updates'

export const CONTENT_LEGACY_ROOTS = [
  '/guide',
  '/charts',
  '/task-groups',
  '/group-report',
  '/research',
  '/hot-keywords',
  '/trend-discovery',
  '/site-intel',
  '/weight-monitor',
  '/index-monitor',
  '/competitor-daily',
  '/index-pages',
  '/sites',
  '/crawl-log',
  '/development-log',
  '/feedback',
  '/settings',
] as const

export function contentSystemPath(path: string): string {
  if (!path || path === '/') return CONTENT_SYSTEM_ROOT
  return `${CONTENT_SYSTEM_ROOT}${path.startsWith('/') ? path : `/${path}`}`
}
export function legacyContentRedirect(pathname: string): string | null {
  const root = CONTENT_LEGACY_ROOTS.find(path => pathname === path || pathname.startsWith(`${path}/`))
  return root ? `${CONTENT_SYSTEM_ROOT}${pathname}` : null
}
