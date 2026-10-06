import test from 'node:test'
import assert from 'node:assert/strict'
import { buildAizhanKeywordPageUrl, normalizeAizhanKeywordUrl, parseAizhanKeywordPage } from '../lib/aizhan-keyword-backfill'

const startUrl = 'https://baidurank.aizhan.com/mobile/youxiniao.com/game/0/1/exp/-1/'

test('accepts only the intended Aizhan descending-volume URL and builds pages', () => {
  assert.equal(normalizeAizhanKeywordUrl(startUrl), startUrl)
  assert.equal(buildAizhanKeywordPageUrl(startUrl, 2), 'https://baidurank.aizhan.com/mobile/youxiniao.com/game/0/2/exp/-1/')
  assert.equal(normalizeAizhanKeywordUrl('https://example.com/mobile/a.com/game/0/1/exp/-1/'), null)
  assert.equal(normalizeAizhanKeywordUrl('https://baidurank.aizhan.com/mobile/a.com/game/0/1/exp/1/'), null)
})

test('parses an Aizhan table whose header row is not wrapped in thead', () => {
  const html = `
    <table>
      <tr><td>目录(大约词数)</td><td>关键字</td><td>排名</td><td>(移动)搜索量</td><td>网页标题</td></tr>
      <tbody>
        <tr><td rowspan="2">game</td><td><a>蛋仔派对官服正版下载</a></td><td>第4页 第10位</td><td>1,385</td><td>标题</td></tr>
        <tr><td><a>休闲游戏</a></td><td>第2页</td><td>0</td><td>标题</td></tr>
      </tbody>
    </table>`
  const parsed = parseAizhanKeywordPage(html, startUrl)
  assert.deepEqual(parsed.rows, [{ keyword: '蛋仔派对官服正版下载', volume: 1385 }])
  assert.equal(parsed.sawZeroVolume, true)
})
