import assert from 'node:assert/strict'
import test from 'node:test'
import { fetchLatestUrlRanks } from '../lib/tracking-rank-lookup'

test('latest URL rank sorting accepts bigint identifiers returned as numbers', async () => {
  const service = {
    rpc: async () => ({
      data: [
        { id: 20, url: 'https://example.com/a', keyword: '词', rank_position: 8, prev_rank: 10, volume: 100, stat_date: '2026-09-25', platform: 'mobile', type: 'rankup' },
        { id: 10, url: 'https://example.com/a', keyword: '词', rank_position: 8, prev_rank: 10, volume: 100, stat_date: '2026-09-25', platform: 'mobile', type: 'rankup' },
      ],
      error: null,
    }),
  }

  const rows = await fetchLatestUrlRanks(service, ['https://example.com/a'])

  assert.deepEqual(rows.map(row => row.id), [10, 20])
})
