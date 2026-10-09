import assert from 'node:assert/strict'
import test from 'node:test'
import iconv from 'iconv-lite'
import {
  contentFeedDatabaseRows,
  decodeContentFeedBytes,
  parse4399NewGames,
  parse52PojieRss,
  parseCcplayNews,
  parseContentFeedSources,
} from '../lib/content-feed'

test('52pojie GBK RSS is decoded and reduced to public metadata', () => {
  const rss = `<?xml version="1.0" encoding="gbk"?>
    <rss><channel><item>
      <title>示例软件 v1.2</title>
      <link>https://www.52pojie.cn/thread-123456-1-1.html</link>
      <description><![CDATA[<b>简短介绍</b>，不保存完整正文。]]></description>
      <author>测试作者</author>
      <enclosure url="https://attach.52pojie.cn/example.jpg" />
      <pubDate>Fri, 09 Oct 2026 01:40:39 +0000</pubDate>
    </item></channel></rss>`
  const decoded = decodeContentFeedBytes(iconv.encode(rss, 'gb18030'), 'gb18030')
  const [item] = parse52PojieRss(decoded)
  assert.equal(item.source, '52pojie')
  assert.equal(item.sourceId, '123456')
  assert.equal(item.category, 'software')
  assert.equal(item.title, '示例软件 v1.2')
  assert.equal(item.author, '测试作者')
  assert.equal(item.summary, '简短介绍，不保存完整正文。')
  assert.equal(item.coverUrl, 'https://attach.52pojie.cn/example.jpg')
  assert.equal(item.publishedAt, '2026-10-09T01:40:39.000Z')
})
test('4399 parser only reads the latest-game list and canonicalizes metadata', () => {
  const html = `<ul id="j-gamelist"><li><a class="m_game"><span class="ks_name">推荐位</span></a></li></ul>
    <ul id="j-newGamelist"><li>
      <a href="/game-id-421789.html" class="m_game" title="小妖去旅行">
        <img src="//f04.img4399.com/game.jpg"><span class="ks_name">小妖去旅行</span>
      </a>
      <span class="type">类型：<a>休闲娱乐</a></span><span class="update">2026-10-09</span>
    </li></ul>`
  const items = parse4399NewGames(html)
  assert.equal(items.length, 1)
  assert.deepEqual(items[0], {
    source: '4399',
    sourceId: '421789',
    category: 'new_game',
    title: '小妖去旅行',
    url: 'https://a.4399.cn/game-id-421789.html',
    coverUrl: 'https://f04.img4399.com/game.jpg',
    author: null,
    summary: '休闲娱乐',
    publishedAt: '2026-10-08T16:00:00.000Z',
  })
})

test('4399 parser rejects impossible calendar dates instead of normalizing them', () => {
  const html = `<ul id="j-newGamelist"><li>
    <a href="/game-id-1.html" class="m_game"><span class="ks_name">无效日期游戏</span></a>
    <span class="update">2026-02-31</span>
  </li></ul>`
  const [item] = parse4399NewGames(html)
  assert.equal(item.publishedAt, null)
})

test('ccplay parser reads list metadata without fetching article bodies', () => {
  const html = `<div class="info_item"><a href="//m2.ccplay.cn/news/152465.html">
    <div class="info_msg"><p>掌上狩猎之旅</p><div class="info_opt">
      <span class="l">2026-10-08</span><span class="r">虫虫小编</span>
    </div></div><img src="//ws-resource.ccplay.cn/cover.png" alt="掌上狩猎之旅">
  </a></div>`
  const [item] = parseCcplayNews(html, 'game_guide')
  assert.equal(item.sourceId, '152465')
  assert.equal(item.category, 'game_guide')
  assert.equal(item.author, '虫虫小编')
  assert.equal(item.url, 'https://m2.ccplay.cn/news/152465.html')
  assert.equal(item.coverUrl, 'https://ws-resource.ccplay.cn/cover.png')
})

test('source filters are comma-separated, deduplicated and strict', () => {
  assert.deepEqual(parseContentFeedSources('4399, ccplay,4399'), {
    sources: ['4399', 'ccplay'],
    invalid: [],
  })
  assert.deepEqual(parseContentFeedSources('4399,unknown'), {
    sources: ['4399'],
    invalid: ['unknown'],
  })
  assert.deepEqual(parseContentFeedSources(', ,'), {
    sources: ['52pojie', '4399', 'ccplay'],
    invalid: [],
  })
})

test('database upsert rows deliberately preserve first_seen_at', () => {
  const rows = contentFeedDatabaseRows([parseCcplayNews(`<div class="info_item"><a href="/news/1.html">
    <div class="info_msg"><p>标题</p><div class="info_opt"><span>2026-10-09</span><span>作者</span></div></div>
  </a></div>`)[0]], '2026-10-09T05:00:00.000Z')
  assert.equal(rows.length, 1)
  assert.equal(rows[0].last_seen_at, '2026-10-09T05:00:00.000Z')
  assert.equal(Object.hasOwn(rows[0], 'first_seen_at'), false)
})
