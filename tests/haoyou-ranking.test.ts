import assert from 'node:assert/strict'
import test from 'node:test'
import { parseHaoyouPopularRanking, parseHaoyouSearchTrends } from '../lib/haoyou-ranking'

test('parseHaoyouSearchTrends reads the public header search list', () => {
  const result = parseHaoyouSearchTrends(`
    <div id="header_hot_search"><ul class="list">
      <li><a href="//www.3839.com/search.php?word=a">关键词一</a></li>
      <li><a href="/search.php?word=b">关键词二</a></li>
    </ul></div>`)
  assert.deepEqual(result.map((item) => item.name), ['关键词一', '关键词二'])
  assert.equal(result[0].url, 'https://www.3839.com/search.php?word=a')
})

test('parseHaoyouPopularRanking excludes paid and buyout games', () => {
  const result = parseHaoyouPopularRanking(`
    <div class="game-item"><div class="item-num">1</div><div class="item-con" data-url="//www.3839.com/a/1.htm">
      <span class="sp-name">免费游戏</span><div class="sp-score">8.8</div><div class="sp-tags"><span>动作</span></div>
    </div></div>
    <div class="game-item"><div class="item-num">2</div><div class="item-con"><a data-price-gid="2">￥18</a>
      <span class="sp-name">付费游戏</span>
    </div></div>
    <div class="game-item"><div class="item-num">3</div><div class="item-con"><span class="sp-name">买断游戏</span><span class="sp-tag">买断制</span></div></div>`)
  assert.deepEqual(result, [{ rank: 1, name: '免费游戏', tags: ['动作'], score: '8.8', url: 'https://www.3839.com/a/1.htm' }])
})
