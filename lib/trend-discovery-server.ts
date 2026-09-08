import 'server-only'

import { timingSafeEqual } from 'node:crypto'
import { createClient, createServiceClient } from './supabase-server'
import { isProjectOwner } from './project-owner'
import { isTrendPlatform, type TrendPlatform } from './trend-discovery'

export type TrendCaller = {
  id: string
  role: 'normal' | 'admin' | 'super'
  isOwner: boolean
}

export async function getTrendCaller(): Promise<{ caller: TrendCaller | null; service: any }> {
  const auth = await createClient()
  const { data: { user } } = await auth.auth.getUser()
  const service = createServiceClient() as any
  if (!user) return { caller: null, service }

  const { data: profile } = await service
    .from('user_profiles')
    .select('role, is_active')
    .eq('id', user.id)
    .maybeSingle()
  if (!profile || profile.is_active === false || !['normal', 'admin', 'super'].includes(profile.role)) {
    return { caller: null, service }
  }
  return {
    caller: {
      id: user.id,
      role: profile.role,
      isOwner: profile.role === 'super' && isProjectOwner(user.id),
    },
    service,
  }
}

function safeTokenEqual(actual: string, expected: string): boolean {
  const actualBuffer = Buffer.from(actual)
  const expectedBuffer = Buffer.from(expected)
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer)
}

export function authorizeTrendCollector(request: Request): { ok: true } | { ok: false; missingConfiguration: boolean } {
  const expected = process.env.TREND_INGEST_SECRET?.trim() ?? ''
  if (expected.length < 24) return { ok: false, missingConfiguration: true }
  const authorization = request.headers.get('authorization') ?? ''
  const actual = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : ''
  return safeTokenEqual(actual, expected)
    ? { ok: true }
    : { ok: false, missingConfiguration: false }
}

export function parseCollectorPlatform(value: unknown): TrendPlatform | null {
  return isTrendPlatform(value) ? value : null
}
