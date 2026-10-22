import assert from 'node:assert/strict'
import test from 'node:test'
import { parseMomorankHtml, parseWechatPublicHtml, fetchGameDiscoveryDataset, DiscoverySourceBlocked } from '../lib/game-discovery-collector'
import { validateGameDiscoveryCollection, type GameDiscoveryItem } from '../lib/game-discovery-sources'
import { allowsServiceAuthPath } from '../lib/service-api-access'

const date='2020-10-20'
const wrapper=(html:string)=>`<html><head><title>微信小游戏排行榜 - MomoRank</title></head><body><div hidden id="S:1"><p>数据日期：${date}</p>${html}</div></body></html>`
const item=(position=1):GameDiscoveryItem=>({position,sourceId:String(position),title:`游戏${position}`,summary:'简介',url:`https://www.momorank.com/games/${position}`,metric:null,change:'持平',tags:[]})
function ranking(size=10) {
  return wrapper(`<span>导出 CSV ${size} 条</span><table><thead><tr><th>排名</th><th>游戏</th><th>简介</th><th>变化</th></tr></thead><tbody>${Array.from({length:size+2},(_,i)=>`<tr><td>${i+1}</td><td><a href="/games/${i+1}"><span title="游戏${i+1}">游戏${i+1}</span></a><span title="公司">公司</span></td><td>简介${i+1}</td><td>+${i}</td></tr>`).join('')}</tbody></table><script>window.PAID_DATA={title:'付费秘密'};</script>`)
}
test('MomoRank reads only the first ten public table rows, not hidden JSON or duplicate mobile tables',()=>{
  const data=parseMomorankHtml(ranking()+ranking(),'momo_bestseller')
  assert.equal(data.sourceDate,date);assert.equal(data.items.length,10)
  assert.equal(data.items[0].title,'游戏1');assert.equal(data.items[0].summary,'简介1')
  assert.equal(data.items[0].url,'https://www.momorank.com/games/1')
  assert.ok(!JSON.stringify(data).includes('付费秘密'));assert.ok(!JSON.stringify(data).includes('游戏11'))
})
test('blurred or normally hidden rows remain excluded instead of bypassing paid visibility',()=>{
  assert.throws(()=>parseMomorankHtml(ranking().replace('<tr><td>1</td>','<tr class="blur-sm"><td>1</td>'),'momo_bestseller'))
  assert.throws(()=>parseMomorankHtml(ranking().replace('<tr><td>1</td>','<tr hidden><td>1</td>'),'momo_bestseller'))
})
test('hot words use their own source date and appear once even with desktop/mobile duplicates',()=>{
  const html=wrapper(`<span>导出 CSV 2 条</span>${[1,2,1,2].map(i=>`<div><span>#${i}</span><span>热词${i}</span></div>`).join('')}`)
  const data=parseMomorankHtml(html,'momo_hot_words')
  assert.deepEqual(data.items.map(row=>row.title),['热词1','热词2'])
  assert.equal(data.items[0].metric,null)
  assert.throws(()=>parseMomorankHtml(html.replace(`数据日期：${date}`,''),'momo_hot_words'))
})
test('IP heat and daily ranking changes retain their source meaning, not invented search counts',()=>{
  const ip=parseMomorankHtml(wrapper('<table><thead><tr><th>排名</th><th>合作 IP</th><th>热度指数</th><th>变化</th><th>标签</th></tr></thead><tbody><tr><td>#1</td><td><p class="font-medium">故事甲</p><p>题材说明</p></td><td>约 100 万</td><td>+100</td><td><span>古风</span></td></tr></tbody></table>'),'momo_ip')
  assert.equal(ip.items[0].title,'故事甲');assert.equal(ip.items[0].metric,'约 100 万');assert.equal(ip.items[0].change,'+100')
  assert.equal(ip.items[0].summary,'题材说明');assert.deepEqual(ip.items[0].tags,['古风'])
  const rising=parseMomorankHtml(wrapper('<table><thead><tr><th>游戏</th><th>畅销榜排名</th><th>日升降</th><th>7日净升降</th><th>近7日走势</th></tr></thead><tbody><tr><td><a href="/games/3?type=bestseller">游戏丙</a></td><td>#53</td><td>+21</td><td>历史不足</td><td>Pro 查看走势</td></tr></tbody></table>'),'momo_rising')
  assert.equal(rising.items[0].metric,'#53');assert.equal(rising.items[0].position,1)
  assert.deepEqual(rising.items[0].tags,['7日净升降 历史不足'])
})
test('WeChat public display extracts only game fields, never friend names, avatars or credentials',()=>{
  const payload={head_info:{rank_id:3},list:[{wxag_game:{app_info:{base:{appid:'wx141bfb9b73c970a9',appname:'游戏',game_type_main_name:'休闲',game_type_sub_name:'消除'},detail:{brief_intro:'简介'}},nick_name_list:['不应保存的朋友'],icon_url_list:['https://private.test/avatar']},pc_appitem:{token:'不应保存的凭证'}}]}
  const html=`<script>window.__DETAIL_DATA__=${JSON.stringify(payload)};window.__OTHER__={};</script>`
  const rows=parseWechatPublicHtml(html,'wechat_popularity')
  assert.deepEqual(rows[0],{position:1,sourceId:'wx141bfb9b73c970a9',title:'游戏',summary:'简介',url:null,metric:null,change:null,tags:['休闲','消除']})
  assert.ok(!JSON.stringify(rows).includes('不应保存'))
  assert.throws(()=>parseWechatPublicHtml(html,'wechat_bestseller'))
})
test('ingest validates provider scope, dates, counts, normalized fields and URL allowlist',()=>{
  const collection={dataset:'momo_bestseller',collectedAt:'2020-10-21T00:00:00Z',sourceDate:date,sourceModifiedAt:null,items:[item()]}
  assert.equal(validateGameDiscoveryCollection({...collection,rawHtml:'discard'}).items.length,1)
  assert.ok(!('rawHtml' in validateGameDiscoveryCollection({...collection,rawHtml:'discard'})))
  for(const change of [{dataset:'__proto__'},{sourceDate:null},{sourceDate:'2020-02-31'},{sourceDate:'2099-01-01'},{items:[]},{items:Array.from({length:11},(_,i)=>item(i+1))},{items:[{...item(),url:'https://evil.test/games/1'}]},{items:[{...item(),position:2}]}])assert.throws(()=>validateGameDiscoveryCollection({...collection,...change}))
  assert.throws(()=>validateGameDiscoveryCollection({...collection,dataset:'wechat_popularity'}))
  assert.equal(allowsServiceAuthPath('/api/charts/game-discovery/ingest'),true)
  assert.equal(allowsServiceAuthPath('/api/charts/game-discovery'),false)
})
test('source fetch stops on verification and oversized pages, without browser login or retry',async()=>{
  for(const status of [401,403,429]){
    let calls=0
    await assert.rejects(fetchGameDiscoveryDataset('momo_hot_words',(async()=>{calls++;return new Response('',{status})}) as typeof fetch),DiscoverySourceBlocked)
    assert.equal(calls,1)
  }
  await assert.rejects(fetchGameDiscoveryDataset('momo_hot_words',(async()=>new Response(' '.repeat(2_000_001))) as typeof fetch))
})
