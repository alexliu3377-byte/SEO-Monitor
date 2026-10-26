import { createClient } from '@supabase/supabase-js'
import { environmentSnapshotResponse } from '../lib/environment-snapshot'
import { monthlyTrendResponse } from '../lib/monthly-trend-data'
import { computeGroupTrackingPayload, saveGroupTrackingPayload } from '../lib/group-tracking-cache'

function option(name: string) {
  return process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3)
}

async function checkResponse(response: Response) {
  const body = await response.json()
  if (!response.ok || body.success === false) {
    throw new Error(body.error || `Cache operation failed: HTTP ${response.status}`)
  }
  return body
}

async function main() {
  const kind = option('kind')
  const groupId = option('group-id')
  if (!['tracking', 'monthly', 'environment'].includes(kind ?? '')) throw new Error('Invalid --kind')
  if (kind === 'tracking' && !/^[0-9a-f-]{36}$/i.test(groupId ?? '')) throw new Error('Tracking requires --group-id=UUID')
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Supabase worker credentials are not configured')
  const service = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })

  if (kind === 'tracking') {
    const rows = await computeGroupTrackingPayload(service, groupId!)
    const result = await saveGroupTrackingPayload(service, groupId!, rows)
    console.log(JSON.stringify({ success: true, kind, groupId, rows: rows.length, ...result }))
  } else if (kind === 'environment') {
    const body = await checkResponse(await environmentSnapshotResponse(service, option('date') || undefined))
    console.log(JSON.stringify({ success: true, kind, date: body.date }))
  } else {
    const now = new Date(Date.now() + 8 * 3600000)
    const month = now.toISOString().slice(0, 7)
    const previousMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)).toISOString().slice(0, 7)
    for (const params of [new URLSearchParams({ refresh: '1' }), new URLSearchParams({ month: previousMonth }), new URLSearchParams({ month, refresh: '1' })]) {
      await checkResponse(await monthlyTrendResponse(service, params, true))
      console.log(JSON.stringify({ success: true, kind, month: params.get('month') ?? 'overview' }))
    }
  }
}

main().catch(error => {
  console.error(`Derived cache refresh failed: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
