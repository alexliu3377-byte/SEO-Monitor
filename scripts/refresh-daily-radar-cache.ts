import { createClient } from '@supabase/supabase-js'
import { refreshDailyRadarCaches } from '../lib/radar-daily'

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Daily radar worker credentials not configured')
  const date = process.argv.find(value => value.startsWith('--date='))?.slice(7)
  const days = Number(process.argv.find(value => value.startsWith('--days='))?.slice(7) || 7)
  if (!Number.isInteger(days) || days < 1 || days > 7) throw new Error('--days must be 1..7')
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
  console.log(JSON.stringify({ dailyRadarRefresh: await refreshDailyRadarCaches(db, { date, days }) }))
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'Daily radar refresh failed'); process.exitCode = 1 })
