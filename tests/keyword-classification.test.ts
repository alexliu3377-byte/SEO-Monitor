import assert from 'node:assert/strict'
import test from 'node:test'
import { inferredAppSubcategory, isRankingKeyword } from '../lib/keyword-classification'

test('ranking category accepts only the configured ranking markers', () => {
  for (const keyword of [
    '手游排行榜', '热门游戏榜单', '前10名软件', '前十手游',
    '前20应用', '前二十游戏', '十大平台', '10大必玩游戏', '前 10 游戏',
  ]) {
    assert.equal(isRankingKeyword(keyword), true, keyword)
  }
})

test('ranking category rejects recommendation and vague ranking intent', () => {
  for (const keyword of [
    '2025年最火的回合制游戏', '热搜榜', '好玩回合制手游',
    '预定酒店哪个平台好', '免费看动漫的软件app推荐', '好玩的策略游戏',
    '看黄金涨跌有什么软件', '手游排行', '游戏平台排名', '哪个软件好',
  ]) {
    assert.equal(isRankingKeyword(keyword), false, keyword)
  }
})

test('application keywords force AI tool and browser subcategories', () => {
  assert.equal(inferredAppSubcategory('ChatGPT下载'), 'AI工具')
  assert.equal(inferredAppSubcategory('豆包官方网站'), 'AI工具')
  assert.equal(inferredAppSubcategory('AI智能志愿填报助手'), 'AI工具')
  assert.equal(inferredAppSubcategory('谷歌浏览器下载'), '浏览器')
  assert.equal(inferredAppSubcategory('Microsoft Edge'), '浏览器')
  assert.equal(inferredAppSubcategory('AI浏览器推荐'), '浏览器')
  assert.equal(inferredAppSubcategory('百度地图'), null)
  assert.equal(inferredAppSubcategory('AirPlay投屏'), null)
})
