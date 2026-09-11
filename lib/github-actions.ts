const DEFAULT_GITHUB_REPOSITORY = 'alexliu3377-byte/SEO-Monitor'
const REPOSITORY_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/

export const CRAWL_STEPS = [
  'all',
  'keywords',
  'rank',
  'weight',
  'index-pages',
  'rank-title',
  'tracking',
] as const

export type CrawlStep = (typeof CRAWL_STEPS)[number]

export function isCrawlStep(value: unknown): value is CrawlStep {
  return typeof value === 'string' && CRAWL_STEPS.includes(value as CrawlStep)
}

export function normalizeCrawlDomain(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const input = value.trim().toLowerCase()
  if (!input || input.length > 253) return null

  try {
    const url = new URL(input.includes('://') ? input : `https://${input}`)
    const hostname = url.hostname.replace(/\.$/, '')
    if (
      !hostname ||
      url.username ||
      url.password ||
      url.port ||
      (url.protocol !== 'http:' && url.protocol !== 'https:') ||
      !hostname.includes('.') ||
      !/^[a-z0-9.-]+$/.test(hostname) ||
      hostname.split('.').some(label => !label || label.length > 63 || label.startsWith('-') || label.endsWith('-'))
    ) {
      return null
    }
    return hostname
  } catch {
    return null
  }
}

export function getGitHubActionsRepository() {
  const configured = process.env.GITHUB_ACTIONS_REPOSITORY?.trim()
  return configured && REPOSITORY_RE.test(configured)
    ? configured
    : DEFAULT_GITHUB_REPOSITORY
}

export async function dispatchGitHubWorkflow(
  workflow: string,
  inputs: Record<string, string>
) {
  const pat = process.env.GITHUB_PAT
  if (!pat) {
    return { ok: false as const, status: 500, error: '服务器未配置 GITHUB_PAT，请联系管理员' }
  }

  const repository = getGitHubActionsRepository()
  const response = await fetch(
    `https://api.github.com/repos/${repository}/actions/workflows/${encodeURIComponent(workflow)}/dispatches`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${pat}`,
        'Content-Type': 'application/json',
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: JSON.stringify({ ref: 'main', inputs }),
    }
  )

  if (!response.ok) {
    const detail = await response.text()
    console.error(`GitHub workflow dispatch failed (${response.status}): ${detail}`)
    return { ok: false as const, status: 502, error: `GitHub Actions 任务启动失败（${response.status}）` }
  }

  return { ok: true as const }
}
