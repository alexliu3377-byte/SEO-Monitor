import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fetchDouyinMinigameRankings, MINIGAME_BOARDS } from '../lib/douyin-minigames'

async function main() {
  const envFile = resolve(process.env.TREND_ENV_FILE || '.env.trend.local')
  if (existsSync(envFile)) for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const match = line.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/)
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2')
  }
  const write = process.argv.includes('--write')
  if (process.argv.slice(2).some(arg => arg !== '--write')) throw new Error('Only --write is supported; omit it for a read-only test')
  const base = process.env.TREND_INGEST_URL?.trim(), secret = process.env.TREND_INGEST_SECRET?.trim()
  if (write && (!base || !secret)) throw new Error('TREND_INGEST_URL / TREND_INGEST_SECRET 未配置')
  const result = await fetchDouyinMinigameRankings()
  const counts = Object.fromEntries(MINIGAME_BOARDS.map(board => [board, result.items.filter(row => row.board === board).length]))
  if (!write) { console.log(JSON.stringify({ dryRun: true, counts, first: result.items.filter(row => row.rank === 1) })); return }
  const endpoint = new URL('/api/charts/douyin-minigames/ingest', new URL(base!).origin)
  const response = await fetch(endpoint, { method: 'POST', headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(result), signal: AbortSignal.timeout(60_000), redirect: 'error' })
  const data = await response.json().catch(() => null)
  if (!response.ok || !Number.isInteger(data?.accepted) || (data.accepted !== result.items.length && !(data.accepted === 0 && data.ignored === true))) {
    throw new Error(`小游戏入库失败 HTTP ${response.status}；${data?.error || '返回结果无效'}`)
  }
  console.log(JSON.stringify({ source: 'douyin_minigame', counts, ...data }))
}
main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1 })
