import { UUID_PATTERN } from './content-transcript'

export const AGENT_EVIDENCE_KINDS = ['summary', 'article_body', 'platform_manual', 'platform_auto', 'local_asr'] as const
export type AgentEvidence = {
  origin: 'qixin_content_feed'
  item_id: string
  source: string
  kind: typeof AGENT_EVIDENCE_KINDS[number]
  url: string
  published_at: string | null
  observed_at: string
  text_updated_at: string | null
  original_length: number
  truncated: boolean
}

const sourceHosts: Record<string, readonly string[]> = {
  '52pojie': ['52pojie.cn'], '4399': ['4399.cn', '4399.com'], ccplay: ['ccplay.cn'],
  bilibili: ['bilibili.com', 'b23.tv'], xiaohongshu: ['xiaohongshu.com', 'xhslink.com'],
  xiaoheihe_guide: ['xiaoheihe.cn', 'heybox.hk'], xiaoheihe_ns: ['xiaoheihe.cn', 'heybox.hk'],
}

// Source links are provenance only: never fetch them or pass private share tokens to a model.
export function agentSourceUrl(source: string, value: string) {
  const hosts = Object.hasOwn(sourceHosts, source) ? sourceHosts[source] : undefined
  const url = new URL(value)
  if (!hosts || value.length > 2048 || url.protocol !== 'https:' || url.username || url.password || url.port
    || !hosts.some(host => url.hostname === host || url.hostname.endsWith(`.${host}`))) throw new Error('资料来源链接无效')
  url.hash = ''
  for (const key of [...url.searchParams.keys()]) {
    if (!['mod', 'tid', 'id', 'p', 'page'].includes(key)) url.searchParams.delete(key)
  }
  // Even allowed query keys must contain short public identifiers, not embedded credentials.
  for (const value of url.searchParams.values()) {
    if (!/^[a-zA-Z0-9_.-]{1,80}$/.test(value)) throw new Error('资料来源链接参数无效')
  }
  return url.toString()
}

export function validateAgentEvidence(value: unknown, textLength: number): asserts value is AgentEvidence {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('资料来源记录无效')
  const row = value as AgentEvidence
  const date = (value: unknown) => typeof value === 'string' && /^\d{4}-\d\d-\d\dT/.test(value) && Number.isFinite(Date.parse(value))
  if (row.origin !== 'qixin_content_feed' || !UUID_PATTERN.test(row.item_id)
    || !(AGENT_EVIDENCE_KINDS as readonly unknown[]).includes(row.kind)
    || typeof row.source !== 'string' || typeof row.url !== 'string'
    || agentSourceUrl(row.source, row.url) !== row.url
    || (row.published_at !== null && !date(row.published_at)) || !date(row.observed_at)
    || (row.text_updated_at !== null && !date(row.text_updated_at))
    || !Number.isInteger(row.original_length) || row.original_length < textLength || row.original_length > 120000
    || row.truncated !== (row.original_length > textLength)) throw new Error('资料来源记录无效')
}

export function canSupportAgentDraft(evidence?: AgentEvidence) {
  // Explicitly provided local text retains the prototype's existing manual-material behavior.
  return !evidence || evidence.kind !== 'summary'
}
