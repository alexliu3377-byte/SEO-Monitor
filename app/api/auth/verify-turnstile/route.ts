import { NextResponse } from 'next/server'

export async function POST(req: Request) {
  void req
  return NextResponse.json({ error: 'Turnstile verification is part of the login request' }, { status: 410 })
  /*
  const { token } = await req.json() as { token: string }

  if (!token) {
    return NextResponse.json({ error: '缺少验证 token' }, { status: 400 })
  }

  const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      secret: process.env.TURNSTILE_SECRET_KEY,
      response: token,
    }),
  })

  const data = await res.json() as { success: boolean; 'error-codes'?: string[] }

  if (!data.success) {
    return NextResponse.json({ error: '人机验证失败，请重试' }, { status: 400 })
  }

  return NextResponse.json({ success: true })
  */
}
