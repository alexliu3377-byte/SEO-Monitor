import { checkAgentText, type AgentReference } from './local-content-agent'
import { agentSourceUrl, validateAgentEvidence, type AgentEvidence } from './content-agent-source'
import { UUID_PATTERN } from './content-transcript'

export const AGENT_MATERIAL_FORMAT = 'qixin-agent-materials'
export type AgentMaterialBundle = {
  format: typeof AGENT_MATERIAL_FORMAT
  version: 1
  exported_at: string
  read_only: true
  references: AgentReference[]
}
export type AgentFeedMaterial = {
  id: string; source: string; title: string; url: string; summary: string | null
  published_at: string | null; first_seen_at: string
}
export type AgentTranscriptMaterial = {
  item_id: string; status: string; transcript_text: string | null; article_text: string | null
  text_source: string | null; updated_at: string
}

export function parseAgentMaterialIds(raw: string | null) {
  if (typeof raw !== 'string' || raw.length > 400) throw new Error('请明确选择 1 至 8 个不重复的内容资料编号')
  const ids = (raw ?? '').split(',').map(value => value.trim())
  if (!ids.length || ids.length > 8 || ids.some(id => !UUID_PATTERN.test(id)) || new Set(ids).size !== ids.length) {
    throw new Error('请明确选择 1 至 8 个不重复的内容资料编号')
  }
  return ids
}

export function mayExportAgentMaterials(caller: { role: string; isOwner: boolean } | null) {
  return caller?.role === 'super' && caller.isOwner === true
}

export function buildAgentMaterialBundle(ids: string[], items: AgentFeedMaterial[], transcripts: AgentTranscriptMaterial[], exportedAt = new Date().toISOString()): AgentMaterialBundle {
  parseAgentMaterialIds(ids.join(','))
  if (items.length !== ids.length || new Set(items.map(item => item.id)).size !== ids.length
    || items.some(item => !ids.includes(item.id))) throw new Error('所选资料不完整，请重新选择；未生成部分成功的资料包')
  const references = ids.map((id, index): AgentReference => {
    const item = items.find(item => item.id === id)!
    const saved = transcripts.find(row => row.item_id === id)
    let text = [item.title, item.summary].filter(Boolean).join('\n').trim()
    let kind: AgentEvidence['kind'] = 'summary'
    let textUpdatedAt: string | null = null
    if (saved?.article_text?.trim()) {
      text = saved.article_text.trim(); kind = 'article_body'; textUpdatedAt = saved.updated_at
    }
    if (saved?.status === 'completed' && saved.transcript_text?.trim()
      && ['platform_manual', 'platform_auto', 'local_asr'].includes(saved.text_source ?? '')) {
      text = saved.transcript_text.trim(); kind = saved.text_source as AgentEvidence['kind']; textUpdatedAt = saved.updated_at
    }
    // Check the original before excerpting so secrets outside the excerpt fail closed too.
    checkAgentText(text, 120000, '所选资料')
    const excerpt = text.slice(0, 12000).trim()
    const evidence: AgentEvidence = {
      origin: 'qixin_content_feed', item_id: id, source: item.source, kind,
      url: agentSourceUrl(item.source, item.url), published_at: item.published_at,
      observed_at: item.first_seen_at, text_updated_at: textUpdatedAt,
      original_length: text.length, truncated: text.length > excerpt.length,
    }
    validateAgentEvidence(evidence, excerpt.length)
    return { id: `ref-${index + 1}`, name: checkAgentText(item.title, 240, '资料名').slice(0, 120), text: excerpt, evidence }
  })
  return parseAgentMaterialBundle({ format: AGENT_MATERIAL_FORMAT, version: 1, exported_at: exportedAt, read_only: true, references })
}

export function parseAgentMaterialBundle(value: unknown): AgentMaterialBundle {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('资料包格式无效')
  const bundle = value as AgentMaterialBundle
  if (bundle.format !== AGENT_MATERIAL_FORMAT || bundle.version !== 1 || bundle.read_only !== true
    || typeof bundle.exported_at !== 'string' || !/^\d{4}-\d\d-\d\dT/.test(bundle.exported_at)
    || !Number.isFinite(Date.parse(bundle.exported_at)) || !Array.isArray(bundle.references)
    || !bundle.references.length || bundle.references.length > 8) throw new Error('资料包格式无效')
  const items = new Set<string>()
  const references = bundle.references.map((ref, index) => {
    if (!ref || ref.id !== `ref-${index + 1}` || !ref.evidence || items.has(ref.evidence.item_id)) throw new Error('资料包编号或来源无效')
    const text = checkAgentText(ref.text, 12000, '资料')
    const name = checkAgentText(ref.name, 120, '资料名')
    validateAgentEvidence(ref.evidence, text.length)
    items.add(ref.evidence.item_id)
    // Whitelist fields instead of relaying arbitrary bundle properties to the model.
    const evidence: AgentEvidence = {
      origin: ref.evidence.origin, item_id: ref.evidence.item_id, source: ref.evidence.source, kind: ref.evidence.kind,
      url: ref.evidence.url, published_at: ref.evidence.published_at, observed_at: ref.evidence.observed_at,
      text_updated_at: ref.evidence.text_updated_at, original_length: ref.evidence.original_length, truncated: ref.evidence.truncated,
    }
    return { id: ref.id, name, text, evidence }
  })
  return { format: AGENT_MATERIAL_FORMAT, version: 1, read_only: true, exported_at: bundle.exported_at, references }
}

// The caller is authenticated by the route; this helper never chooses a user/group or a table from model input.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function loadAgentMaterialBundle(service: any, ids: string[]) {
  parseAgentMaterialIds(ids.join(','))
  const items = await service.from('content_feed_items')
    .select('id,source,title,url,summary,published_at,first_seen_at').in('id', ids).limit(8)
  if (items.error) throw new Error('内容资料读取失败')
  if (!items.data || items.data.length !== ids.length) throw new Error('所选资料不存在或已移除')
  const text = await service.from('content_feed_transcripts')
    .select('item_id,status,transcript_text,article_text,text_source,updated_at').in('item_id', ids).limit(8)
  if (text.error) throw new Error('文字资料读取失败；未把读取失败伪装成只有摘要')
  return buildAgentMaterialBundle(ids, items.data, text.data ?? [])
}
