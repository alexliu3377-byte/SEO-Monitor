import assert from 'node:assert/strict'
import test from 'node:test'
import { parseTapTapSearchTrends } from '../lib/taptap-search-trends'

test('parseTapTapSearchTrends reads ranked search links', () => {
  const html = `
    <a class="tap-hot-search-item__wrapper" href="/search/%E5%8E%9F%E7%A5%9E">原神</a>
    <a href="/search/Phigros" class="tap-hot-search-item__wrapper">Phigros</a>`
  assert.deepEqual(parseTapTapSearchTrends(html).map((item) => item.name), ['原神', 'Phigros'])
})
