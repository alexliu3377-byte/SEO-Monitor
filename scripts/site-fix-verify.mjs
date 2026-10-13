// Read-only verification of the new production RPCs/caches. No raw user data.
import { createClient } from '@supabase/supabase-js'
import { performance } from 'node:perf_hooks'

if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('Missing database configuration')
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const checks = []
async function verify(label,read,summarize) {
  const started = performance.now()
  const { data,error } = await read()
  const check = { label,ok: !error,ms: Math.round(performance.now()-started) }
  if (error) check.error = String(error.message).replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').slice(0,180)
  else Object.assign(check,summarize?.(data) ?? {})
  checks.push(check)
  console.log(JSON.stringify(check))
  return data
}
const cache = await verify('global cache metadata',() => db.from('hot_radar_cache').select('computed_at,failed_sections,section_updated_at').eq('id','latest').single(),data => ({ computedAt: data.computed_at,failedSections: data.failed_sections }))
await verify('one-section radar projection',() => db.from('hot_radar_cache').select('newWords:payload->newWords').eq('id','latest').single(),data => ({ rows: data.newWords?.length,bytes: Buffer.byteLength(JSON.stringify(data)) }))
await verify('all group caches current',() => db.from('group_hot_radar_cache').select('computed_at,source_computed_at,filter_hash,section_updated_at'),rows => ({ rows: rows.length,current: rows.filter(row => row.source_computed_at === cache?.computed_at).length,withSectionTimes: rows.filter(row => Object.keys(row.section_updated_at ?? {}).length === 4).length }))
await verify('word library real SQL page',() => db.rpc('get_wordlib_cache_page',{ p_page: 0,p_page_size: 20 }),data => ({ rows: data.data.length,total: data.total,bytes: Buffer.byteLength(JSON.stringify(data)),computedAt: data.computedAt }))
const { data: groups,error: groupError } = await db.from('task_group_members').select('group_id,user_id').limit(1)
if (groupError) throw new Error('Unable to select recommendation fixture')
if (groups?.[0]) await verify('recommendations real SQL page',() => db.rpc('get_task_group_recommendations_page',{ p_group_id: groups[0].group_id,p_user_ids: [groups[0].user_id],p_type: 'rankdown',p_page: 0,p_page_size: 20 }),data => ({ rows: data.rows.length,total: data.total,bytes: Buffer.byteLength(JSON.stringify(data)) }))
const { data: submissions,error: submissionError } = await db.from('member_claimed_keywords').select('group_id,user_id').eq('status','submitted').order('created_at',{ ascending: false }).limit(1)
if (submissionError) throw new Error('Unable to select submitted recommendation fixture')
if (submissions?.[0]) for (const type of ['rankdown','rankup']) await verify(`submitted-member recommendations ${type}`,() => db.rpc('get_task_group_recommendations_page',{ p_group_id: submissions[0].group_id,p_user_ids: [submissions[0].user_id],p_type: type,p_page: 0,p_page_size: 20 }),data => ({ rows: data.rows.length,total: data.total,bytes: Buffer.byteLength(JSON.stringify(data)) }))
const { data: tracking,error: trackingError } = await db.from('competitor_tracking_records').select('site_id').eq('effectiveness','有效').limit(1)
if (trackingError) throw new Error('Unable to select tracking fixture')
if (tracking?.[0]) await verify('competitor tracking real SQL page',() => db.rpc('get_competitor_tracking_page',{ p_site_id: tracking[0].site_id,p_page: 0,p_page_size: 20 }),data => ({ rows: data.rows.length,total: data.total,bytes: Buffer.byteLength(JSON.stringify(data)) }))
const { data: sites,error: siteError } = await db.from('sites').select('id,domain').eq('has_rank_title',true).order('domain').limit(1)
if (siteError) throw new Error('Unable to select rank fixture')
if (sites?.[0]) {
  const today = new Date(Date.now()+8*3600_000).toISOString().slice(0,10)
  const start = new Date(Date.now()+8*3600_000-30*86400_000).toISOString().slice(0,10)
  await verify('site rank lightweight overview',() => db.rpc('get_site_rank_overview',{ p_site_id: sites[0].id,p_date_start: start,p_date_end: today }),data => ({ rankupRows: data.rankup.length,rankdownRows: data.rankdown.length,unstableRows: data.unstable.length,bytes: Buffer.byteLength(JSON.stringify(data)) }))
  await verify('selected-site source aggregation',() => db.rpc('compute_scoped_hot_radar',{ p_rank_domains: [sites[0].domain],p_new_domains: [sites[0].domain],p_limit: 20 }),data => ({ newRows: data.newWords.length,rankRows: data.rankWords.length,streakRows: data.streakWords.length }))
}
await verify('page studio metadata only',() => db.rpc('get_page_studio_project_summaries'),rows => ({ projects: rows.length,bytes: Buffer.byteLength(JSON.stringify(rows)),htmlExcluded: rows.every(row => !Object.hasOwn(row,'html') && (row.pages ?? []).every(page => !Object.hasOwn(page,'html') && !Object.hasOwn(page,'css') && !Object.hasOwn(page,'document'))) }))
await verify('latest visible weights',() => db.rpc('get_latest_visible_site_weights'),rows => ({ rows: rows.length,bytes: Buffer.byteLength(JSON.stringify(rows)) }))
console.log(JSON.stringify({ verificationComplete: true,checks: checks.length,failed: checks.filter(check => !check.ok).length }))
if (checks.some(check => !check.ok)) process.exitCode = 1
