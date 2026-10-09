import assert from 'node:assert/strict'
import test from 'node:test'
import { parseTapTapPopularRankingHtml } from '../lib/taptap-ranking'

test('parseTapTapPopularRankingHtml reads the public popular ranking JSON-LD', () => {
  const html = `
    <script type="application/ld+json">{"@type":"BreadcrumbList"}</script>
    <script type="application/ld+json">
      {
        "@context": "https://schema.org",
        "@type": "ItemList",
        "name": "热门榜",
        "itemListElement": [
          {"@type":"ListItem","position":2,"url":"https://www.taptap.cn/app/2","name":"游戏二"},
          {"@type":"ListItem","position":1,"url":"https://www.taptap.cn/app/1","name":"游戏一"}
        ]
      }
    </script>`

  assert.deepEqual(parseTapTapPopularRankingHtml(html), [
    { rank: 1, name: '游戏一', labels: [], url: 'https://www.taptap.cn/app/1' },
    { rank: 2, name: '游戏二', labels: [], url: 'https://www.taptap.cn/app/2' },
  ])
})

test('parseTapTapPopularRankingHtml ignores malformed structured data', () => {
  assert.deepEqual(parseTapTapPopularRankingHtml('<script type="application/ld+json">{broken</script>'), [])
})
