import { createClient } from '@supabase/supabase-js'
import iconv from 'iconv-lite'
import { extractAppUpdate, type AppUpdateExtractorConfig } from '../lib/app-update-extractor'
import { fetchPublicUrl } from '../lib/safe-remote-url'

type SourceRow = {
  id: string
  app_id: string
  source_url: string
  source_name: string
  extractor_config: unknown
  app_update_apps: { id: string; name: string; status: string } | null
}

function argument(name: string): string {
  const prefix = `--${name}=`
  return process.argv.find(value => value.startsWith(prefix))?.slice(prefix.length).trim() ?? ''
}

function extractorConfig(value: unknown): AppUpdateExtractorConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const source = value as Record<string, unknown>
  const result: AppUpdateExtractorConfig = {}
  const entries = [
    ['versionSelector', source.versionSelector],
    ['changelogSelector', source.changelogSelector],
    ['releaseDateSelector', source.releaseDateSelector],
    ['packageSizeSelector', source.packageSizeSelector],
    ['downloadUrlSelector', source.downloadUrlSelector],
  ] as const
  for (const [key, selector] of entries) {
    if (typeof selector === 'string' && selector.trim().length <= 200) result[key] = selector.trim()
  }
  return result
}

async function responseText(response: Response): Promise<string> {
  const bytes = Buffer.from(await response.arrayBuffer())
  if (bytes.length > 5_000_000) throw new Error('页面超过 5MB，已停止读取')
  const contentType = response.headers.get('content-type') ?? ''
  const charset = contentType.match(/charset\s*=\s*["']?([^;"'\s]+)/i)?.[1]?.toLowerCase() ?? 'utf-8'
  if (charset.includes('gbk') || charset.includes('gb2312') || charset.includes('gb18030')) {
    return iconv.decode(bytes, 'gb18030')
  }
  return bytes.toString('utf8')
}

async function main() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  if (!supabaseUrl || !serviceKey) throw new Error('缺少 Supabase GitHub Actions secrets')
  const service = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })
  const appId = argument('app-id')
  const limit = Math.min(100, Math.max(1, Number.parseInt(argument('limit') || '20', 10) || 20))

  let query = service
    .from('app_update_sources')
    .select('id, app_id, source_url, source_name, extractor_config, app_update_apps!inner(id, name, status)')
    .eq('enabled', true)
    .eq('app_update_apps.status', 'active')
    .order('last_checked_at', { ascending: true, nullsFirst: true })
    .limit(limit)
  if (appId) query = query.eq('app_id', appId)
  const { data, error } = await query
  if (error) throw new Error(`读取应用来源失败：${error.message}`)
  const sources = (data ?? []) as unknown as SourceRow[]
  console.log(`本轮需要检查 ${sources.length} 个更新来源`)
  let failedSources = 0

  for (const [index, source] of sources.entries()) {
    const startedAt = new Date().toISOString()
    const { data: run, error: runError } = await service
      .from('app_update_crawl_runs')
      .insert({
        app_id: source.app_id,
        source_id: source.id,
        status: 'running',
        started_at: startedAt,
        action_run_id: process.env.GITHUB_RUN_ID ?? null,
      })
      .select('id').single()
    if (runError || !run) throw new Error(`建立抓取记录失败：${runError?.message ?? '未知错误'}`)

    try {
      console.log(`[${index + 1}/${sources.length}] ${source.app_update_apps?.name ?? source.source_name}`)
      const response = await fetchPublicUrl(source.source_url, {
        headers: {
          'User-Agent': 'QixinAppUpdateResearch/0.1 (+internal version research)',
          Accept: 'text/html,application/xhtml+xml,application/json;q=0.8,*/*;q=0.5',
        },
        signal: AbortSignal.timeout(30_000),
      })
      if (!response.ok) throw new Error(`来源页面返回 HTTP ${response.status}`)
      const html = await responseText(response)
      const extracted = extractAppUpdate(html, source.source_url, extractorConfig(source.extractor_config))
      if (!extracted) throw new Error('没有自动识别到版本号，需要为这个来源补充解析规则')

      const { data: existing } = await service
        .from('app_update_releases')
        .select('id')
        .eq('source_id', source.id)
        .eq('normalized_version', extracted.normalizedVersion)
        .maybeSingle()
      const runStatus = existing ? 'no_change' : 'completed'
      const now = new Date().toISOString()
      const { error: releaseError } = await service.from('app_update_releases').upsert({
        app_id: source.app_id,
        source_id: source.id,
        version: extracted.version,
        normalized_version: extracted.normalizedVersion,
        changelog: extracted.changelog,
        release_date: extracted.releaseDate,
        package_size: extracted.packageSize,
        download_url: extracted.downloadUrl,
        source_url: source.source_url,
        extraction_confidence: extracted.confidence,
        last_collected_at: now,
      }, { onConflict: 'source_id,normalized_version' })
      if (releaseError) throw new Error(`保存版本资料失败：${releaseError.message}`)

      const [sourceUpdate, runUpdate] = await Promise.all([
        service.from('app_update_sources').update({
          last_status: runStatus === 'completed' ? 'success' : 'no_change',
          last_checked_at: now,
          last_success_at: now,
          last_error: null,
          consecutive_failures: 0,
        }).eq('id', source.id),
        service.from('app_update_crawl_runs').update({
          status: runStatus,
          discovered_version: extracted.version,
          completed_at: now,
        }).eq('id', run.id),
      ])
      if (sourceUpdate.error || runUpdate.error) {
        throw new Error(`更新抓取状态失败：${sourceUpdate.error?.message ?? runUpdate.error?.message}`)
      }
      console.log(`  ${runStatus === 'completed' ? '发现新版本' : '版本没有变化'}：${extracted.version}`)
    } catch (crawlError) {
      failedSources += 1
      const message = (crawlError instanceof Error ? crawlError.message : String(crawlError)).slice(0, 1000)
      const completedAt = new Date().toISOString()
      const { data: currentSource } = await service
        .from('app_update_sources').select('consecutive_failures').eq('id', source.id).maybeSingle()
      const [sourceFailure, runFailure] = await Promise.all([
        service.from('app_update_sources').update({
          last_status: 'error',
          last_checked_at: completedAt,
          last_error: message,
          consecutive_failures: (currentSource?.consecutive_failures ?? 0) + 1,
        }).eq('id', source.id),
        service.from('app_update_crawl_runs').update({
          status: 'failed', error_message: message, completed_at: completedAt,
        }).eq('id', run.id),
      ])
      if (sourceFailure.error || runFailure.error) {
        console.error(`  写入失败状态时出错：${sourceFailure.error?.message ?? runFailure.error?.message}`)
      }
      console.error(`  失败：${message}`)
    }
    if (index < sources.length - 1) await new Promise(resolve => setTimeout(resolve, 4_000))
  }

  if (failedSources > 0) {
    throw new Error(`本轮有 ${failedSources} 个来源抓取失败，请查看应用更新中心的抓取记录`)
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
