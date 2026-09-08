import { NextResponse } from 'next/server'
import { cleanTrendText, parseTrendSignalInput } from '@/lib/trend-discovery'
import { authorizeTrendCollector, parseCollectorPlatform } from '@/lib/trend-discovery-server'
import { createServiceClient } from '@/lib/supabase-server'

export const maxDuration = 60

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const NODE_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{2,63}$/

function jsonError(error: string, status: number) {
  return NextResponse.json({ error }, { status })
}

export async function POST(request: Request) {
  const collectorAuth = authorizeTrendCollector(request)
  if (!collectorAuth.ok) {
    return jsonError(
      collectorAuth.missingConfiguration ? '趋势采集密钥尚未配置' : '趋势采集认证失败',
      collectorAuth.missingConfiguration ? 503 : 401
    )
  }

  const contentLength = Number.parseInt(request.headers.get('content-length') ?? '0', 10)
  if (Number.isFinite(contentLength) && contentLength > 1_000_000) {
    return jsonError('单次趋势信号包不能超过 1MB', 413)
  }

  const body = await request.json().catch(() => null) as Record<string, unknown> | null
  if (!body) return jsonError('趋势信号格式无效', 400)

  const node = body.node && typeof body.node === 'object' && !Array.isArray(body.node)
    ? body.node as Record<string, unknown>
    : null
  const run = body.run && typeof body.run === 'object' && !Array.isArray(body.run)
    ? body.run as Record<string, unknown>
    : null
  const nodeId = cleanTrendText(node?.id, 64).toLowerCase()
  const nodeName = cleanTrendText(node?.name, 80)
  const collectorVersion = cleanTrendText(node?.version, 30)
  const platform = parseCollectorPlatform(run?.platform)
  const runId = cleanTrendText(run?.id, 40)
  const runStatus = run?.status
  const startedAt = cleanTrendText(run?.startedAt, 40)
  const completedAt = cleanTrendText(run?.completedAt, 40)
  const errorCode = cleanTrendText(run?.errorCode, 80) || null
  const errorMessage = cleanTrendText(run?.errorMessage, 1000) || null

  if (!NODE_ID_PATTERN.test(nodeId) || nodeName.length < 2 || !collectorVersion) {
    return jsonError('采集节点资料无效', 400)
  }
  if (!platform || !UUID_PATTERN.test(runId) || !['completed', 'failed', 'blocked'].includes(String(runStatus))) {
    return jsonError('采集运行资料无效', 400)
  }
  if (!Number.isFinite(Date.parse(startedAt)) || !Number.isFinite(Date.parse(completedAt))) {
    return jsonError('采集运行时间无效', 400)
  }
  const startedIso = new Date(startedAt).toISOString()
  const completedIso = new Date(completedAt).toISOString()
  if (completedIso < startedIso || Date.parse(completedIso) > Date.now() + 5 * 60_000) {
    return jsonError('采集运行时间范围无效', 400)
  }

  const rawSignals = Array.isArray(body.signals) ? body.signals : []
  if (rawSignals.length > 200) return jsonError('单次最多接收 200 条趋势信号', 400)
  const parsedSignals = rawSignals.map(value => parseTrendSignalInput(platform, value))
  if (parsedSignals.some(signal => !signal)) return jsonError('趋势信号中包含无效内容或非官方来源链接', 400)
  const allowedCollectedStart = Date.parse(startedIso) - 5 * 60_000
  const allowedCollectedEnd = Date.parse(completedIso) + 5 * 60_000
  if (parsedSignals.some(signal => signal && (
    Date.parse(signal.collectedAt) < allowedCollectedStart
    || Date.parse(signal.collectedAt) > allowedCollectedEnd
  ))) {
    return jsonError('趋势信号采集时间不在本轮运行范围内', 400)
  }
  const signalMap = new Map<string, NonNullable<typeof parsedSignals[number]>>()
  for (const signal of parsedSignals) {
    if (!signal) continue
    const existing = signalMap.get(signal.externalId)
    if (!existing) signalMap.set(signal.externalId, signal)
    else {
      existing.tags = [...new Set([...existing.tags, ...signal.tags])].slice(0, 20)
      existing.candidateTerms = [...new Set([...existing.candidateTerms, ...signal.candidateTerms])].slice(0, 20)
    }
  }
  const validSignals = [...signalMap.values()]

  const service = createServiceClient() as any
  const nodeStatus = runStatus === 'completed' ? 'online' : runStatus === 'blocked' ? 'blocked' : 'error'
  const { data: existingNode } = await service
    .from('trend_collector_nodes')
    .select('platforms, last_success_at')
    .eq('id', nodeId)
    .maybeSingle()
  const { error: nodeError } = await service.from('trend_collector_nodes').upsert({
    id: nodeId,
    name: nodeName,
    collector_version: collectorVersion,
    platforms: [...new Set([...(existingNode?.platforms ?? []), platform])],
    status: nodeStatus,
    last_seen_at: completedIso,
    last_success_at: runStatus === 'completed' ? completedIso : existingNode?.last_success_at ?? null,
    last_error: runStatus === 'completed' ? null : errorMessage || errorCode || '采集失败',
  }, { onConflict: 'id' })
  if (nodeError) {
    const missingMigration = nodeError.code === '42P01'
    return jsonError(missingMigration ? '趋势发现数据库迁移尚未运行' : '采集节点状态写入失败', missingMigration ? 503 : 500)
  }

  const { error: runError } = await service.from('trend_collection_runs').upsert({
    id: runId,
    node_id: nodeId,
    platform,
    status: runStatus,
    started_at: startedIso,
    completed_at: completedIso,
    signal_count: validSignals.length,
    error_code: errorCode,
    error_message: errorMessage,
  }, { onConflict: 'id' })
  if (runError) return jsonError('采集运行记录写入失败', 500)
  if (validSignals.length === 0) {
    const { error: cleanupError } = await service.rpc('cleanup_trend_discovery_data')
    if (cleanupError) return jsonError('趋势资料维护失败', 500)
    return NextResponse.json({ accepted: 0, terms: 0, runId })
  }

  const externalIds = [...new Set(validSignals.map(signal => signal.externalId))]
  const { data: existingRows, error: existingError } = await service
    .from('trend_signals')
    .select('external_id, first_collected_at, last_collected_at, published_at, tags, query_terms')
    .eq('platform', platform)
    .in('external_id', externalIds)
  if (existingError) return jsonError('已有趋势信号读取失败', 500)
  const existingMap = new Map((existingRows ?? []).map((row: any) => [row.external_id, row]))

  const signalRows = validSignals.map(signal => {
    const existing = existingMap.get(signal.externalId) as any
    const firstCollectedAt = existing?.first_collected_at && existing.first_collected_at < signal.collectedAt
      ? existing.first_collected_at
      : signal.collectedAt
    return {
      platform,
      external_id: signal.externalId,
      source_url: signal.sourceUrl,
      title: signal.title,
      excerpt: signal.excerpt,
      tags: [...new Set([...(existing?.tags ?? []), ...signal.tags])].slice(0, 30),
      query_terms: [...new Set([...(existing?.query_terms ?? []), ...(signal.queryTerm ? [signal.queryTerm] : [])])].slice(0, 30),
      published_at: signal.publishedAt ?? existing?.published_at ?? null,
      first_collected_at: firstCollectedAt,
      last_collected_at: existing?.last_collected_at && existing.last_collected_at > signal.collectedAt
        ? existing.last_collected_at
        : signal.collectedAt,
      latest_metrics: signal.metrics,
      latest_run_id: runId,
      latest_node_id: nodeId,
    }
  })
  const { data: storedSignals, error: signalError } = await service
    .from('trend_signals')
    .upsert(signalRows, { onConflict: 'platform,external_id' })
    .select('id, external_id')
  if (signalError) return jsonError('趋势信号写入失败', 500)
  const storedMap = new Map<string, string>((storedSignals ?? []).map((row: any) => [row.external_id, row.id] as [string, string]))

  const snapshots = validSignals.flatMap(signal => {
    const signalId = storedMap.get(signal.externalId)
    return signalId ? [{
      signal_id: signalId,
      run_id: runId,
      node_id: nodeId,
      query_term: signal.queryTerm,
      metrics: signal.metrics,
      collected_at: signal.collectedAt,
    }] : []
  })
  const { error: snapshotError } = await service
    .from('trend_signal_snapshots')
    .upsert(snapshots, { onConflict: 'signal_id,run_id', ignoreDuplicates: true })
  if (snapshotError) return jsonError('趋势快照写入失败', 500)

  const termSeenAt = new Map<string, string>()
  for (const signal of validSignals) {
    for (const term of signal.candidateTerms) {
      const current = termSeenAt.get(term)
      if (!current || signal.collectedAt < current) termSeenAt.set(term, signal.collectedAt)
    }
  }
  const termRows = [...termSeenAt].map(([term, observedAt]) => ({
    normalized_term: term,
    display_term: term,
    first_seen_at: observedAt,
    last_seen_at: observedAt,
  }))
  if (termRows.length > 0) {
    const { error: insertTermError } = await service
      .from('trend_terms')
      .upsert(termRows, { onConflict: 'normalized_term', ignoreDuplicates: true })
    if (insertTermError) return jsonError('候选趋势词写入失败', 500)

    const { data: storedTerms, error: readTermError } = await service
      .from('trend_terms')
      .select('id, normalized_term')
      .in('normalized_term', [...termSeenAt.keys()])
    if (readTermError) return jsonError('候选趋势词读取失败', 500)
    const termMap = new Map<string, string>((storedTerms ?? []).map((row: any) => [row.normalized_term, row.id] as [string, string]))
    const links: { signal_id: string; term_id: string; observed_at: string }[] = []
    for (const signal of validSignals) {
      const signalId = storedMap.get(signal.externalId)
      if (!signalId) continue
      for (const term of signal.candidateTerms) {
        const termId = termMap.get(term)
        if (termId) links.push({ signal_id: signalId, term_id: termId, observed_at: signal.collectedAt })
      }
    }
    if (links.length > 0) {
      const { error: linkError } = await service
        .from('trend_signal_terms')
        .upsert(links, { onConflict: 'signal_id,term_id', ignoreDuplicates: true })
      if (linkError) return jsonError('趋势词来源关联失败', 500)
    }
  }

  const { error: cleanupError } = await service.rpc('cleanup_trend_discovery_data')
  if (cleanupError) return jsonError('趋势分数更新或资料维护失败', 500)
  return NextResponse.json({ accepted: validSignals.length, terms: termSeenAt.size, runId })
}
