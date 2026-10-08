import assert from 'node:assert/strict'
import test from 'node:test'
import { inferredAppSubcategory, inferredGameSubcategory, isRankingKeyword } from '../lib/keyword-classification'

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

test('clear game intents use the refined subcategories', () => {
  assert.equal(inferredGameSubcategory('好玩的动作手游'), '动作')
  assert.equal(inferredGameSubcategory('开放世界冒险游戏'), '冒险')
  assert.equal(inferredGameSubcategory('休闲小游戏大全'), '休闲')
  assert.equal(inferredGameSubcategory('卡牌挂机游戏'), '放置')
  assert.equal(inferredGameSubcategory('手机棋牌游戏'), '棋牌')
  assert.equal(inferredGameSubcategory('武侠角色扮演手游'), '武侠')
  assert.equal(inferredGameSubcategory('5v5 moba手游'), 'MOBA')
  assert.equal(inferredGameSubcategory('开放世界沙盒游戏'), '沙盒')
  assert.equal(inferredGameSubcategory('儿童益智游戏'), '益智')
  assert.equal(inferredGameSubcategory('宠物养成手游'), '养成')
})

test('clear application intents use the refined subcategories', () => {
  assert.equal(inferredAppSubcategory('免费漫画阅读软件'), '漫画')
  assert.equal(inferredAppSubcategory('小说阅读器'), '小说')
  assert.equal(inferredAppSubcategory('手机地图导航'), '导航')
  assert.equal(inferredAppSubcategory('酒店预订软件'), '酒店')
  assert.equal(inferredAppSubcategory('手机文件管理器'), '文件管理')
  assert.equal(inferredAppSubcategory('拍照文字识别软件'), '扫描识别')
  assert.equal(inferredAppSubcategory('汇率换算计算器'), '计算工具')
  assert.equal(inferredAppSubcategory('wifi测速工具'), '实用工具')
  assert.equal(inferredAppSubcategory('电视直播软件'), '直播')
  assert.equal(inferredAppSubcategory('短视频app'), '短视频')
  assert.equal(inferredAppSubcategory('跑步健身软件'), '运动健身')
  assert.equal(inferredAppSubcategory('招聘找工作app'), '招聘求职')
  assert.equal(inferredAppSubcategory('本地天气预报'), '天气')
  assert.equal(inferredAppSubcategory('新闻头条app'), '新闻')
})
