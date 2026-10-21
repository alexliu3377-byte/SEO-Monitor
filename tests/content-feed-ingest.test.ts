import assert from 'node:assert/strict'
import test from 'node:test'
import { isCollectorContentSource, parseCollectorContentItem } from '../lib/content-feed-ingest'

test('public collector only accepts known sources and their official article URLs', () => {
  assert.equal(isCollectorContentSource('unknown'), false)
  assert.equal(isCollectorContentSource('52pojie'), true)
  assert.equal(isCollectorContentSource('__proto__'), false)
  assert.equal(parseCollectorContentItem('4399', { title: '新游戏', category: 'new_game', url: 'https://evil.test/game-id-1.html' }), null)
  assert.equal(parseCollectorContentItem('4399', { title: '新游戏', category: 'new_game', url: 'https://a.4399.cn.evil.test/game-id-1.html' }), null)
  assert.equal(parseCollectorContentItem('4399', { title: '新游戏', category: 'software', url: 'https://a.4399.cn/game-id-1.html' }), null)
  assert.equal(parseCollectorContentItem('52pojie', { title: '软件', category: 'software', url: 'https://www.52pojie.cn/forum.php?mod=forumdisplay&fid=16' }), null)
  assert.equal(parseCollectorContentItem('ccplay', { title: '资讯', category: 'game_news', url: 'http://m2.ccplay.cn/news/123.html' }), null)
})

test('forum source categories survive ingestion separately from the software content type', () => {
  const parsed = parseCollectorContentItem('52pojie',{title:'测试工具',url:'https://www.52pojie.cn/thread-123-1-1.html',category:'software',sourceCategory:' Android\n ',publishedAt:'2026-10-20T08:00:00Z'})
  assert.equal(parsed?.category,'software')
  assert.equal(parsed?.sourceCategory,'Android')
  assert.equal(parsed?.publishedAt,'2026-10-20T08:00:00.000Z')
  assert.equal(parseCollectorContentItem('52pojie',{title:'工具',url:'https://www.52pojie.cn/thread-1-1-1.html',category:'software'})?.sourceCategory,null)
})

test('public item IDs are derived from source URLs, not trusted from input', () => {
  for (const [source, url, category, expected] of [
    ['52pojie', 'https://www.52pojie.cn/thread-123-1-1.html', 'software', '123'],
    ['52pojie', 'https://www.52pojie.cn/forum.php?mod=viewthread&tid=456', 'software', '456'],
    ['4399', 'https://a.4399.cn/game-id-789.html', 'new_game', '789'],
    ['ccplay', 'https://m2.ccplay.cn/news/42.html', 'game_guide', '42'],
  ] as const) {
    const parsed = parseCollectorContentItem(source, { sourceId: 'wrong', title: '测试资料', url, category, publishedAt: 'invalid' })
    assert.equal(parsed?.sourceId, expected)
    assert.equal(parsed?.publishedAt, null)
  }
})

test('browser ingestion preserves Xiaohongshu access tokens and strips Bilibili analytics', () => {
  const xhs = parseCollectorContentItem('xiaohongshu', { title: '游戏资源', url: 'https://www.xiaohongshu.com/explore/abc?xsec_token=token&xsec_source=pc_search&source=tracking' })
  const xhsUrl = new URL(xhs!.url)
  assert.equal(xhsUrl.searchParams.get('xsec_token'), 'token')
  assert.equal(xhsUrl.searchParams.get('xsec_source'), 'pc_search')
  assert.equal(xhsUrl.searchParams.has('source'), false)
  const bili = parseCollectorContentItem('bilibili', { title: '视频资料', url: 'https://www.bilibili.com/video/BVtest?spm_id_from=333.999&t=12' })
  assert.equal(bili?.url, 'https://www.bilibili.com/video/BVtest?t=12')
})
