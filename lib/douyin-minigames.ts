// Public data used by https://game.open-douyin.com/ itself. No account cookies,
// signing service, DataEye, or client-side source requests are involved.
export const DOUYIN_MINIGAME_SOURCE_URL = 'https://game.open-douyin.com/'
export const DOUYIN_MINIGAME_RANK_URL = `${DOUYIN_MINIGAME_SOURCE_URL}bff_api_game/PlatBaseSettingService/GetGameRankList`
export const MINIGAME_BOARDS = ['new', 'hot', 'grossing'] as const
export type MinigameBoard = typeof MINIGAME_BOARDS[number]
export const MINIGAME_BOARD_LABELS: Record<MinigameBoard, string> = { new: '新游榜', hot: '热门榜', grossing: '畅销榜' }
export const MINIGAME_RANK_LIMIT = 100
const SOURCE_PAGE_SIZE = 50
const MAX_RESPONSE_BYTES = 1_000_000

export type MinigameRanking = {
  board: MinigameBoard
  rank: number
  gameId: string
  title: string
  summary: string | null
}
const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
const clean = (value: string) => value.replace(/\s+/g, ' ').trim()

export function validateMinigameRankings(value: unknown): MinigameRanking[] {
  if (!Array.isArray(value) || value.length < 3 || value.length > MINIGAME_RANK_LIMIT * 3) throw new Error('小游戏榜单数量无效')
  const items = value.map(raw => {
    const row = record(raw)
    if (!row || !MINIGAME_BOARDS.includes(row.board as MinigameBoard)
      || !Number.isInteger(row.rank) || Number(row.rank) < 1 || Number(row.rank) > MINIGAME_RANK_LIMIT
      || typeof row.gameId !== 'string' || !/^tt(?:[a-f0-9]{16}|[a-f0-9]{18})$/.test(row.gameId)
      || typeof row.title !== 'string' || !clean(row.title) || row.title.length > 240
      || (row.summary !== null && (typeof row.summary !== 'string' || row.summary.length > 500))) throw new Error('小游戏榜单字段无效')
    return { board: row.board as MinigameBoard, rank: Number(row.rank), gameId: row.gameId,
      title: clean(row.title), summary: typeof row.summary === 'string' ? clean(row.summary) || null : null }
  })
  for (const board of MINIGAME_BOARDS) {
    const group = items.filter(row => row.board === board).sort((a, b) => a.rank - b.rank)
    if (!group.length || new Set(group.map(row => row.gameId)).size !== group.length
      || group.some((row, index) => row.rank !== index + 1)) throw new Error('小游戏榜单缺失、重复或排名不连续')
  }
  return items
}

export function parseDouyinMinigamePage(value: unknown, offset = 0): { items: MinigameRanking[]; hasMore: boolean } {
  if (![0, SOURCE_PAGE_SIZE].includes(offset)) throw new Error('小游戏榜单分页范围无效')
  const payload = record(value), data = record(payload?.data)
  if (payload?.error !== 0 || !Array.isArray(data?.GameRankList)) throw new Error('抖音小游戏未返回有效榜单')
  const items: MinigameRanking[] = [], seen = new Set<string>()
  let hasMore = false
  for (const entry of data.GameRankList) {
    const group = record(record(entry)?.RankGroup)
    const board = MINIGAME_BOARDS.find(key => MINIGAME_BOARD_LABELS[key] === group?.RankName)
    if (!group || !board || seen.has(board) || !Array.isArray(group.Games) || group.Games.length > SOURCE_PAGE_SIZE
      || typeof group.HasMore !== 'boolean') throw new Error('抖音小游戏榜单结构已变化')
    seen.add(board)
    if (!group.Games.length && offset === 0) throw new Error('抖音小游戏榜单为空，保留已有资料')
    if (group.HasMore && group.Games.length !== SOURCE_PAGE_SIZE) throw new Error('抖音小游戏榜单分页不完整')
    hasMore ||= group.HasMore
    group.Games.forEach((raw, index) => {
      const game = record(raw)
      if (!game || typeof game.ID !== 'string' || typeof game.Name !== 'string'
        || (game.Summary != null && typeof game.Summary !== 'string')) throw new Error('抖音小游戏条目无效')
      items.push({ board, rank: offset + index + 1, gameId: game.ID, title: game.Name,
        summary: typeof game.Summary === 'string' ? game.Summary : null })
    })
  }
  if (seen.size !== MINIGAME_BOARDS.length) throw new Error('抖音小游戏缺少部分榜单，保留已有资料')
  return { items, hasMore }
}

async function readPage(offset: number, request: typeof fetch) {
  const response = await request(DOUYIN_MINIGAME_RANK_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Referer: DOUYIN_MINIGAME_SOURCE_URL },
    body: JSON.stringify({ Limit: SOURCE_PAGE_SIZE, Name: MINIGAME_BOARDS.map(board => MINIGAME_BOARD_LABELS[board]), Offset: offset }),
    signal: AbortSignal.timeout(20_000), redirect: 'error', cache: 'no-store',
  })
  if (!response.ok) throw new Error(`抖音小游戏返回 HTTP ${response.status}，本次停止，不覆盖已有资料`)
  const reader = response.body?.getReader()
  if (!reader) throw new Error('抖音小游戏响应为空')
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MAX_RESPONSE_BYTES) throw new Error('抖音小游戏响应超过大小限制')
      chunks.push(value)
    }
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock() }
  const bytes = new Uint8Array(size)
  let position = 0
  for (const chunk of chunks) { bytes.set(chunk, position); position += chunk.length }
  return parseDouyinMinigamePage(JSON.parse(new TextDecoder().decode(bytes)), offset)
}

export async function fetchDouyinMinigameRankings(options: { request?: typeof fetch; pause?: () => Promise<void> } = {}) {
  const collectedAt = new Date().toISOString()
  const first = await readPage(0, options.request ?? fetch)
  let items = first.items
  if (first.hasMore) {
    await (options.pause ?? (() => new Promise(resolve => setTimeout(resolve, 8_000))))()
    const next = await readPage(SOURCE_PAGE_SIZE, options.request ?? fetch)
    items = [...items, ...next.items]
  }
  return { collectedAt, items: validateMinigameRankings(items) }
}
