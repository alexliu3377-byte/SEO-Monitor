import { createClient } from '@supabase/supabase-js'
import { refreshHotRadarCaches } from '../lib/hot-radar-refresh'

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !secret) throw new Error('Supabase worker credentials are not configured')
  const dateIndex = process.argv.indexOf('--date')
  const equalsDateArgument = process.argv.find(argument => argument.startsWith('--date='))
  const dateArgument = equalsDateArgument?.slice('--date='.length)
    ?? (dateIndex >= 0 ? process.argv[dateIndex + 1] : undefined)
  if ((dateIndex >= 0 || equalsDateArgument !== undefined) && !dateArgument) throw new Error('--date requires YYYY-MM-DD')
  const sourceDate = dateArgument || process.env.DATA_DATE || undefined
  const service = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } })
  const result = await refreshHotRadarCaches(service, { sourceDate })
  console.log(JSON.stringify(result))
  // Source warnings describe incomplete inputs, not a failed calculation.
  // Available data and later jobs remain usable when sourceComplete=false.
  if (!result.complete) process.exitCode = 1
}

main().catch(error => {
  console.error(`Cache refresh failed: ${error instanceof Error ? error.message : error}`)
  process.exitCode = 1
})
