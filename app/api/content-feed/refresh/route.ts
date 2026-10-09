import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import {
  contentFeedDatabaseRows,
  fetchContentFeedSource,
  parseContentFeedSources,
  type ContentFeedSource,
} from '@/lib/content-feed'
import { createServiceClient } from '@/lib/supabase-server'

export const maxDuration = 90

type SourceResult = {
  source: ContentFeedSource
  ok: boolean
  fetched: number
  stored: number
  error: string | null
  warnings: string[]
}
function safeSecretEqual(actual: string, expected: string): boolean {
  const actualBuffer = Buffer.from(actual)
  const expectedBuffer = Buffer.from(expected)
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer)
}

function authorizeCron(request: Request): boolean {
  const expected = process.env.CRON_SECRET?.trim() ?? ''
  if (!expected) return false
  const header = request.headers.get('authorization') ?? ''
  const actual = header.startsWith('Bearer ') ? header.slice(7).trim() : ''
  return safeSecretEqual(actual, expected)
}

async function refreshSource(service: any, source: ContentFeedSource, seenAt: string): Promise<SourceResult> {
  try {
    const { items, warnings } = await fetchContentFeedSource(source)
    const { data, error } = await service
      .from('content_feed_items')
      .upsert(contentFeedDatabaseRows(items, seenAt), { onConflict: 'source,source_id' })
      .select('id')
    if (error) throw error
    return {
      source,
      ok: true,
      fetched: items.length,
      stored: data?.length ?? items.length,
      error: null,
      warnings,
    }
  } catch (error) {
    const message = error instanceof Error
      ? error.message
      : error && typeof error === 'object' && 'message' in error
        ? String(error.message)
        : 'unknown source failure'
    console.error(`[content-feed] ${source} refresh failed:`, message)
    return { source, ok: false, fetched: 0, stored: 0, error: message.slice(0, 240), warnings: [] }
  }
}

export async function POST(request: Request) {
  if (!process.env.CRON_SECRET?.trim()) {
    return NextResponse.json({ error: 'CRON_SECRET is not configured' }, { status: 503 })
  }
  if (!authorizeCron(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const params = new URL(request.url).searchParams
  const selected = parseContentFeedSources(params.get('sources'))
  if (selected.invalid.length > 0) {
    return NextResponse.json({ error: `Unsupported sources: ${selected.invalid.join(', ')}` }, { status: 400 })
  }

  const service = createServiceClient() as any
  const refreshedAt = new Date().toISOString()
  // A parser/network/database failure is isolated to its source. Promise.all
  // waits for every source, so one rejection can never prevent the others from
  // being fetched and stored.
  const results = await Promise.all(
    selected.sources.map(source => refreshSource(service, source, refreshedAt)),
  )
  const succeeded = results.filter(result => result.ok).length
  const response = {
    success: succeeded > 0,
    complete: succeeded === results.length && results.every(result => result.warnings.length === 0),
    refreshedAt,
    results,
  }
  return NextResponse.json(response, { status: succeeded > 0 ? 200 : 502 })
}
