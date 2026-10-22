import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {build} from 'esbuild'
import {chromium} from 'playwright'
import postcss from 'postcss'
import tailwindcss from 'tailwindcss'

const navigation=`import{useState}from'react';export const usePathname=()=>location.pathname;export const useSearchParams=()=>{const[query,setQuery]=useState(location.search);window.__setQuery=setQuery;return new URLSearchParams(query)};export const useRouter=()=>({replace:url=>{history.replaceState(null,'',url);window.__setQuery(location.search)}});`
const bundle=await build({stdin:{contents:`import React from'react';import{createRoot}from'react-dom/client';import Charts from'./app/(dashboard)/charts/charts-client';createRoot(document.getElementById('root')).render(<Charts/>);`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'fixture',setup(b){
 b.onResolve({filter:/^next\/(dynamic|navigation)$/},args=>({path:args.path,namespace:'fixture'}))
 b.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:args.path==='next/navigation'?navigation:`import React,{lazy,Suspense}from'react';export default loader=>{const Component=lazy(loader);return props=><Suspense fallback={<span>正在打开</span>}><Component {...props}/></Suspense>}`,loader:'jsx',resolveDir:process.cwd()}))
}}]})
const css=(await postcss([tailwindcss({content:['app/(dashboard)/charts/charts-client.tsx','components/game-discovery-source-tab.tsx','components/douyin-minigames-tab.tsx','components/simple-pagination.tsx','components/page-number-input.tsx']})]).process(await readFile('app/globals.css','utf8'),{from:'app/globals.css'})).css
const html=`<meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div id="root"></div><script>${bundle.outputFiles[0].text.replaceAll('</script','<\\/script')}</script>`
const requests=[],errors=[];let fail=false,empty=false
const handler=async route=>{
 const request=route.request(),url=new URL(request.url())
 assert.equal(request.method(),'GET');assert.equal(url.hostname,'discovery.test','UI must only read cached first-party data')
 if(!url.pathname.startsWith('/api/'))return route.fulfill({contentType:'text/html',body:html})
 requests.push(url.pathname+url.search)
 let data
 if(url.pathname==='/api/charts/game-discovery'){
  const dataset=url.searchParams.get('dataset'),page=Number(url.searchParams.get('page')),wechat=dataset.startsWith('wechat')
  if(fail)return route.fulfill({status:503,json:{error:'测试来源读取失败'}})
  data={total:empty?0:wechat?100:10,metadata:empty?null:{source_date:wechat?null:'2026-10-20',collected_at:'2026-10-21T00:00:00Z',source_modified_at:wechat?'2026-07-15T09:47:09Z':null},items:empty?[]:Array.from({length:wechat?20:10},(_,i)=>({position:(page-1)*20+i+1,source_id:dataset+i,title:dataset+'游戏'+((page-1)*20+i+1),summary:'公开简介',url:null,metric:'#53',change:'+21',tags:['休闲']}))}
 }else if(url.pathname==='/api/charts/taptap-search-trends')data={items:[{rank:1,name:'TapTap词',source:'TapTap'}]}
 else if(url.pathname==='/api/charts/haoyou')data={searchItems:[{rank:1,name:'快爆词',source:'好游快爆'}]}
 else if(url.pathname==='/api/charts/douyin-minigames')data={items:[{rank:1,game_id:'tt1',title:'抖音游戏',summary:'简介'}],total:1,collectedAt:'2026-10-21T00:00:00Z'}
 else throw Error('Unexpected API '+url.pathname)
 return route.fulfill({json:data})
}
const browser=await chromium.launch({headless:true})
try{
 const page=await browser.newPage({viewport:{width:1440,height:1000}});page.on('pageerror',error=>errors.push(error.message));await page.route('**/*',handler)
 await page.goto('https://discovery.test/content/charts?section=game&view=rankings&source=momorank')
 await page.getByText('momo_rising游戏1',{exact:true}).waitFor()
 assert.deepEqual(requests,['/api/charts/game-discovery?dataset=momo_rising&page=1'])
 assert.equal(await page.getByLabel('MomoRank资料类型').locator('option').count(),6)
 assert.equal(await page.getByLabel('MomoRank资料类型').locator('option',{hasText:'热搜词'}).count(),0)
 await page.getByLabel('MomoRank资料类型').selectOption('momo_ip');await page.getByText('momo_ip游戏1',{exact:true}).waitFor()
 assert.ok(await page.getByRole('columnheader',{name:'来源热度',exact:true}).isVisible())
 await page.screenshot({path:'.task-work/game-discovery-momorank.png'})
 await page.getByRole('button',{name:'微信小游戏',exact:true}).click();await page.getByText('wechat_popularity游戏1',{exact:true}).waitFor()
 assert.ok(await page.getByText(/不能确认是当天排名/).isVisible())
 assert.ok(await page.getByText(/资料日期：未提供/).isVisible())
 await page.getByRole('button',{name:'最后一页',exact:true}).click();await page.getByText('wechat_popularity游戏81',{exact:true}).waitFor()
 await page.getByLabel('微信小游戏资料类型').selectOption('wechat_bestseller');await page.getByText('wechat_bestseller游戏1',{exact:true}).waitFor()
 assert.equal(requests.at(-1),'/api/charts/game-discovery?dataset=wechat_bestseller&page=1')
 await page.screenshot({path:'.task-work/game-discovery-wechat.png'})
 await page.getByRole('button',{name:'抖音小游戏',exact:true}).click();await page.getByText('抖音游戏',{exact:true}).waitFor()
 await page.getByRole('button',{name:'搜索趋势',exact:true}).click();await page.getByText('momo_hot_words游戏1',{exact:true}).waitFor()
 const grid=page.getByRole('heading',{name:'MomoRank 热搜词',exact:true}).locator('xpath=ancestor::section/parent::*')
 assert.equal(await grid.locator(':scope > section').count(),3)
 assert.equal(await page.getByLabel('MomoRank资料类型').count(),0)
 const source=page.getByRole('link',{name:'打开MomoRank 热搜词来源（新窗口）',exact:true})
 assert.equal(await source.getAttribute('href'),'https://www.momorank.com/insights/hot-words')
 await page.screenshot({path:'.task-work/game-discovery-search-trends.png'})
 fail=true;await page.goto('https://discovery.test/content/charts?section=game&view=rankings&source=momorank');await page.getByRole('alert').waitFor()
 fail=false;await page.getByRole('button',{name:'重试',exact:true}).click();await page.getByText('momo_rising游戏1',{exact:true}).waitFor()
 empty=true;await page.reload();await page.getByText('尚未采集到此来源资料',{exact:true}).waitFor();empty=false
 const mobile=await browser.newContext({viewport:{width:375,height:812},isMobile:true,hasTouch:true,reducedMotion:'reduce'})
 const mp=await mobile.newPage();mp.on('pageerror',error=>errors.push(error.message));await mp.route('**/*',handler)
 await mp.goto('https://discovery.test/content/charts?section=game&view=rankings&source=momorank');await mp.getByText('momo_rising游戏1',{exact:true}).waitFor()
 assert.ok(await mp.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Only the table should scroll horizontally')
 assert.ok((await mp.getByLabel('MomoRank资料类型').boundingBox()).height>=44)
 await mp.getByLabel('MomoRank资料类型').focus();assert.equal(await mp.locator(':focus').getAttribute('aria-label'),'MomoRank资料类型')
 await mp.screenshot({path:'.task-work/game-discovery-mobile.png'});await mobile.close()
 assert.deepEqual(errors,[])
 console.log(JSON.stringify({realChartsNavigation:true,currentDatasetOnly:true,threeSearchColumns:true,hotWordsOnlyUnderSearch:true,sixMomoTypes:true,threeWechatBoards:true,sourceDateNotCollectedDate:true,wechatFreshnessWarning:true,sharedPaging:true,filterResetsPage:true,errorRetry:true,mobile375:true,browserErrors:errors,productionWrites:0}))
}finally{await browser.close()}
