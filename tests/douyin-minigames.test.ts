import assert from 'node:assert/strict'
import test from 'node:test'
import { fetchDouyinMinigameRankings, MINIGAME_BOARDS, MINIGAME_BOARD_LABELS, parseDouyinMinigamePage, validateMinigameRankings } from '../lib/douyin-minigames'
import { allowsServiceAuthPath } from '../lib/service-api-access'

function fixture(size = 2, offset = 0, more = false) {
  return { error: 0, data: { GameRankList: MINIGAME_BOARDS.map(board => ({ RankGroup: { RankName: MINIGAME_BOARD_LABELS[board], HasMore: more,
    Games: Array.from({ length: size }, (_, index) => ({ ID: `tt${(offset + index + 1).toString(16).padStart(18, '0')}`, Name: `游戏${offset + index + 1}`, Summary: '官方简介' })) } })) } }
}
test('parse actual public rank structure without fabricating dates, URLs or search volume', () => {
  const parsed = parseDouyinMinigamePage(fixture())
  assert.equal(parsed.items.length, 6)
  assert.deepEqual(parsed.items[0], { board: 'new', rank: 1, gameId: 'tt000000000000000001', title: '游戏1', summary: '官方简介' })
  assert.equal(parsed.hasMore, false)
  assert.equal(validateMinigameRankings(parsed.items).length, 6)
  // Both ID formats were observed on the public official list (older/newer games).
  assert.equal(validateMinigameRankings(parsed.items.map((row, index) => index === 0 ? { ...row, gameId: 'tt0dff7b4292d56f66' } : row)).length, 6)
})
test('partial, empty, malformed and challenge responses fail closed', () => {
  assert.throws(() => parseDouyinMinigamePage({ error: 1, data: {} }))
  assert.throws(() => parseDouyinMinigamePage(fixture(0)))
  const partial = fixture(); partial.data.GameRankList.pop()
  assert.throws(() => parseDouyinMinigamePage(partial))
  const duplicate = fixture(); duplicate.data.GameRankList[2] = duplicate.data.GameRankList[0]
  assert.throws(() => parseDouyinMinigamePage(duplicate))
  assert.throws(() => parseDouyinMinigamePage(fixture(2, 0, true)))
  assert.throws(() => parseDouyinMinigamePage('<html>验证码</html>'))
})
test('snapshot validation rejects duplicate games, rank gaps and unsafe fields', () => {
  const rows = parseDouyinMinigamePage(fixture()).items
  assert.throws(() => validateMinigameRankings(rows.slice(1)))
  assert.throws(() => validateMinigameRankings(rows.map(row => ({ ...row, gameId: 'invalid' }))))
  assert.throws(() => validateMinigameRankings(rows.map(row => ({ ...row, summary: 'x'.repeat(501) }))))
  assert.throws(() => validateMinigameRankings(rows.map(row => ({ ...row, gameId: 'tt000000000000000001' }))))
  assert.throws(() => validateMinigameRankings([...rows, rows[0]]))
})
test('source collection is bounded to two requests and 100 games per board', async () => {
  const calls: number[] = [], pauses: number[] = []
  const result = await fetchDouyinMinigameRankings({ request: (async (url, options) => {
    assert.match(String(url), /^https:\/\/game\.open-douyin\.com\//)
    const body = JSON.parse(String(options?.body)); calls.push(body.Offset)
    assert.equal(body.Limit, 50)
    assert.equal(options?.redirect, 'error')
    return Response.json(fixture(50, body.Offset, true))
  }) as typeof fetch, pause: async () => { pauses.push(1) } })
  assert.deepEqual(calls, [0, 50]); assert.equal(pauses.length, 1)
  assert.equal(result.items.length, 300)
  assert.equal(result.items.at(-1)?.rank, 100)
})
test('403/429 and second-page failure stop instead of publishing a partial snapshot', async () => {
  for (const status of [403, 429]) {
    let calls = 0
    await assert.rejects(fetchDouyinMinigameRankings({ request: (async () => { calls++; return new Response('', { status }) }) as typeof fetch }))
    assert.equal(calls, 1)
  }
  let calls = 0
  await assert.rejects(fetchDouyinMinigameRankings({ request: (async () => ++calls === 1 ? Response.json(fixture(50, 0, true)) : new Response('', { status: 503 })) as typeof fetch, pause: async () => {} }))
  assert.equal(calls, 2)
})
test('oversized source response is rejected and only ingestion bypasses browser auth', async () => {
  await assert.rejects(fetchDouyinMinigameRankings({ request: (async () => new Response(' '.repeat(1_000_001))) as typeof fetch }))
  assert.equal(allowsServiceAuthPath('/api/charts/douyin-minigames/ingest'), true)
  assert.equal(allowsServiceAuthPath('/api/charts/douyin-minigames'), false)
})
