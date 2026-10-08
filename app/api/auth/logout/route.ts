import { NextResponse } from 'next/server'
import { DAILY_LOGIN_COOKIE_NAME } from '@/lib/daily-login'
import { createClient } from '@/lib/supabase-server'

export async function POST() {
  const supabase = await createClient()
  const { error } = await supabase.auth.signOut({ scope: 'local' })

  const response = NextResponse.json(
    error ? { ok: false, error: 'Unable to sign out' } : { ok: true },
    { status: error ? 500 : 200 },
  )

  // Keep logout effective even if the upstream sign-out request fails. Without
  // today's proof cookie, protected routes will require a fresh login.
  response.cookies.set(DAILY_LOGIN_COOKIE_NAME, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 0,
  })

  return response
}
