// Actual feed + reader, local GET-only fixtures. No production data or writes.
import assert from 'node:assert/strict'
import {build} from 'esbuild'
import {chromium} from 'playwright'
import postcss from 'postcss'
import tailwindcss from 'tailwindcss'

const bundle=await build({stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';import Feed from './components/content-feed-tab';createRoot(document.getElementById('root')).render(<Feed kind={location.pathname==='/app'?'app':'all'}/>);`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'dynamic-fixture',setup(b){
 b.onResolve({filter:/^next\/dynamic$/},()=>({path:'dynamic',namespace:'fixture'}))
 b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:`import React,{lazy,Suspense}from'react';export default loader=>{const View=lazy(loader);return props=><Suspense fallback={<span>正在打开文字</span>}><View {...props}/></Suspense>}`,loader:'jsx',resolveDir:process.cwd()}))
}}]})
const css=(await postcss([tailwindcss({content:['components/content-feed-tab.tsx','components/content-transcript-dialog.tsx','components/simple-pagination.tsx','components/page-number-input.tsx']})]).process('@tailwind base;@tailwind utilities;',{from:undefined})).css
const html=`<meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div id="root"></div><script>${bundle.outputFiles[0].text.replaceAll('</script','<\\/script')}</script>`
const cases=[['ready','completed',true],['article','blocked',true],['queued','queued',false],['processing','processing',false],['failed','failed',false],['blocked','blocked',false],['not-video','not_video',false],['no-speech','no_speech',false],['unknown',null,false],['empty-completed','completed',false]]
const browser=await chromium.launch({headless:true}),requests=[],errors=[]
let unavailable=false,detailError=false,emptyDetail=false
const handler=async route=>{
 const req=route.request(),url=new URL(req.url())
 assert.equal(req.method(),'GET','UI must not trigger transcription or any mutation')
 if(!url.pathname.startsWith('/api/'))return route.fulfill({contentType:'text/html',body:html})
 requests.push(url.pathname)
 let body
 if(url.pathname==='/api/content-feed')body={total:cases.length,totalPages:1,page:1,pageSize:20,transcriptStatusUnavailable:unavailable,items:cases.map(([id,status,hasTranscript])=>({id,source:id==='article'?'xiaoheihe_guide':'bilibili',category:'video',title:id,url:'https://example.com/'+id,author:'测试作者',firstSeenAt:'2026-10-21T00:00:00Z',transcriptStatus:status,hasTranscript}))}
 else if(url.pathname.endsWith('/transcript')){
  if(detailError)return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'测试读取失败'})})
  body=emptyDetail?{status:'queued',text:'',message:'内部采集诊断不应显示'}:url.pathname.includes('/article/')?{status:'blocked',text:'',articleText:'已经保存的文章正文',videoExpected:true,message:'内部采集诊断不应显示'}:{status:'completed',text:'已经保存的视频文字',textSource:'platform_auto'}
 }else throw Error('Unexpected API '+url.pathname)
 if(url.pathname==='/api/content-feed'&&url.searchParams.get('sources')==='52pojie')body={total:3,totalPages:1,page:1,pageSize:20,items:['Windows','Android',null].map((sourceCategory,index)=>({id:'app-'+index,source:'52pojie',category:'software',sourceCategory,title:'应用标题'+index,url:'https://www.52pojie.cn/thread-'+index+'-1-1.html',author:'作者',publishedAt:'2026-10-20T08:21:00Z',firstSeenAt:'2026-10-21T00:00:00Z'}))}
 await route.fulfill({contentType:'application/json',body:JSON.stringify(body)})
}
const button=(page,id)=>page.getByRole('button',{name:`查看文字：${id}${cases.find(row=>row[0]===id)?.[2]&&!unavailable?'':'（暂无文字）'}`,exact:true})
const style=locator=>locator.evaluate(node=>{const css=getComputedStyle(node);return{background:css.backgroundColor,color:css.color,border:css.borderColor,cursor:css.cursor}})
try{
 const page=await browser.newPage({viewport:{width:1440,height:1000}})
 page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',handler)
 await page.goto('https://content.test/feed');await button(page,'ready').waitFor()
 assert.equal(await page.getByRole('link',{name:'查看原文',exact:true}).count(),cases.length)
 for(const[id,,ready]of cases){
  const view=button(page,id)
  assert.equal(await view.isDisabled(),!ready)
  if(!ready){
   const before=requests.length,normal=await style(view)
   await view.hover();assert.deepEqual(await style(view),normal,'Disabled text action must have no hover style')
   assert.equal(normal.background,'rgb(255, 255, 255)')
   assert.equal(normal.color,'rgb(203, 213, 225)')
   assert.equal(normal.cursor,'default')
   await view.evaluate(node=>node.click())
   assert.equal(requests.length,before)
   assert.equal(await page.getByRole('dialog').count(),0)
  }
 }
 await button(page,'ready').click();await page.getByText('已经保存的视频文字',{exact:true}).waitFor()
 assert.ok(await page.getByRole('button',{name:'复制文字',exact:true}).isVisible())
 assert.equal(await page.getByRole('button',{name:'刷新状态',exact:true}).count(),0)
 await page.getByRole('button',{name:'关闭文字窗口',exact:true}).click()
 assert.equal(await button(page,'ready').evaluate(node=>node===document.activeElement),true)
 await button(page,'article').click();await page.getByText('已经保存的文章正文',{exact:true}).waitFor()
 assert.equal(await page.getByText('内部采集诊断不应显示',{exact:true}).count(),0)
 await page.keyboard.press('Escape');assert.equal(await page.getByRole('dialog').count(),0)
 await button(page,'ready').focus();await page.keyboard.press('Tab')
 assert.equal(await page.locator(':focus').isDisabled(),false,'Disabled actions must be skipped by keyboard navigation')
 emptyDetail=true;await button(page,'ready').click();await page.getByText('暂无可查看文字，请关闭窗口后刷新列表。',{exact:true}).waitFor()
 assert.equal(await page.getByText('内部采集诊断不应显示',{exact:true}).count(),0)
 await page.getByRole('button',{name:'关闭文字窗口',exact:true}).click();emptyDetail=false
 detailError=true;await button(page,'ready').click();await page.getByRole('alert').waitFor()
 detailError=false;await page.getByRole('button',{name:'重新读取',exact:true}).click();await page.getByText('已经保存的视频文字',{exact:true}).waitFor()
 await page.getByRole('button',{name:'关闭文字窗口',exact:true}).click()
 await page.screenshot({path:'.task-work/content-text-disabled-desktop.png'})
 unavailable=true;await page.reload();await page.getByText('文字状态暂不可用，原文资料仍可查看。',{exact:true}).waitFor()
 for(const[id]of cases)assert.equal(await button(page,id).isDisabled(),true)
 unavailable=false
 const mobile=await browser.newContext({viewport:{width:375,height:812},isMobile:true,hasTouch:true,reducedMotion:'reduce'})
 const mobilePage=await mobile.newPage();mobilePage.on('pageerror',e=>errors.push(e.message));await mobilePage.route('**/*',handler)
 await mobilePage.goto('https://content.test/feed');await button(mobilePage,'ready').waitFor()
 for(const id of ['ready','queued'])assert.ok((await button(mobilePage,id).boundingBox()).height>=44)
 assert.ok(await mobilePage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Table must scroll inside its container')
 await button(mobilePage,'queued').scrollIntoViewIfNeeded();await mobilePage.screenshot({path:'.task-work/content-text-disabled-mobile.png'})
 await button(mobilePage,'ready').click();await mobilePage.getByText('已经保存的视频文字',{exact:true}).waitFor()
 await mobile.close()
 await page.goto('https://content.test/app');await page.getByText('应用标题0',{exact:true}).waitFor()
 assert.deepEqual((await page.locator('thead th').allTextContents()).map(text=>text.trim()),['来源','分类','标题','作者','发布时间','操作'])
 const appRows=page.locator('tbody tr')
 assert.equal(await appRows.nth(0).locator('td').nth(1).innerText(),'Windows')
 assert.equal(await appRows.nth(1).locator('td').nth(1).innerText(),'Android')
 assert.equal(await appRows.nth(2).locator('td').nth(1).innerText(),'—')
 assert.equal(await page.getByRole('combobox').count(),0,'Source category column must not reintroduce the old generic type filter')
 await page.screenshot({path:'.task-work/app-source-categories.png'})
 assert.deepEqual(errors,[])
 console.log(JSON.stringify({appCategoryBeforeTitle:true,unknownCategoryNotInvented:true,readableTextOnly:true,partialArticleKept:true,allEmptyStatesDisabled:true,noHoverOrEmptyRequests:true,noCollectorDiagnostics:true,detailErrorRetry:true,metadataFailsClosed:true,keyboardAndFocus:true,mobile375:true,coarsePointer44:true,browserErrors:errors,productionWrites:0}))
}finally{await browser.close()}
