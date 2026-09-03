import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { createClient as createServiceClient } from '@supabase/supabase-js'

export async function proxy(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()
  const { pathname } = request.nextUrl
  const isApi = pathname.startsWith('/api/')
  const allowsServiceAuth = [
    '/api/cron',
    '/api/environment/daily-snapshot',
    '/api/hot-radar/refresh',
    '/api/tracking-cache/refresh',
  ].some(path => pathname === path || pathname.startsWith(`${path}/`))
  const isPublicApi = pathname.startsWith('/api/auth/') || allowsServiceAuth

  if (!user && isApi && !isPublicApi) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!user && !isApi && !pathname.startsWith('/login')) {
    const loginUrl = request.nextUrl.clone()
    loginUrl.pathname = '/login'
    return NextResponse.redirect(loginUrl)
  }

  if (user && pathname === '/login') {
    const homeUrl = request.nextUrl.clone()
    homeUrl.pathname = '/'
    return NextResponse.redirect(homeUrl)
  }

  // Super administrators are exempt from IP restrictions. All other users
  // fail closed when their access profile cannot be verified.
  if (user && !pathname.startsWith('/blocked')) {
    const ip =
      request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      request.headers.get('x-real-ip') ||
      '127.0.0.1'
    try {
      const service = createServiceClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
      )
      const { data: profile, error } = await service
        .from('user_profiles')
        .select('role, allowed_ips')
        .eq('id', user.id)
        .single()
      if (error || !profile) throw error ?? new Error('Profile not found')
      const isSuperAdmin = profile.role === 'super'
      const allowedIps: string[] = profile.allowed_ips ?? []
      if (!isSuperAdmin && allowedIps.length > 0 && !allowedIps.includes(ip)) {
        if (isApi) {
          return NextResponse.json({ error: 'IP address is not allowed' }, { status: 403 })
        }
        const blockedUrl = request.nextUrl.clone()
        blockedUrl.pathname = '/blocked'
        return NextResponse.redirect(blockedUrl)
      }
    } catch {
      if (isApi) {
        return NextResponse.json({ error: 'Access check failed' }, { status: 503 })
      }
      const blockedUrl = request.nextUrl.clone()
      blockedUrl.pathname = '/blocked'
      blockedUrl.searchParams.set('reason', 'access-check-failed')
      return NextResponse.redirect(blockedUrl)
    }
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
}
