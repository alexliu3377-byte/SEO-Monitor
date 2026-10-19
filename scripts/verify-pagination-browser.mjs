// Real shared control, content feed, homepage search and overwrite dialog with
// local read-only HTTP fixtures. Never sign in or mutate production data.
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {build} from 'esbuild'
import {chromium} from 'playwright'
import postcss from 'postcss'
import tailwindcss from 'tailwindcss'

const stubs={
 '@/lib/user-context':"export const useUser=()=>({id:'test-user',role:'super'});",
 '@/lib/supabase':"export const getBrowserClient=()=>({});",
 'next/dynamic':"export default ()=>()=>null;",
 'next/navigation':"export const useRouter=()=>({push:()=>{},replace:()=>{}});export const usePathname=()=>'/';",
 'next/link':"import React from 'react';export default function Link({href,children,...p}){return <a href={href} {...p}>{children}</a>}",
}
const entry=`import React,{useState} from 'react';import{createRoot}from'react-dom/client';
import{SimplePagination}from'./components/simple-pagination';import Feed from'./components/content-feed-tab';
import Overwrite from'./components/submission-overwrite-dialog';import{KeywordSearchCard}from'./app/(dashboard)/page';
function Demo(){const[page,setPage]=useState(0),[total,setTotal]=useState(250000),[disabled,lock]=useState(false),[calls,log]=useState([]),[submitted,submit]=useState(0);
return <main><form onSubmit={e=>{e.preventDefault();submit(n=>n+1)}}><SimplePagination page={page} total={total} disabled={disabled} onChange={p=>{setPage(p);log(v=>[...v,p])}}/></form>
<button onClick={()=>{setPage(0);setTotal(40)}}>缩小筛选</button><button onClick={()=>lock(v=>!v)}>切换加载</button>
<output id='calls'>{JSON.stringify(calls)}</output><output id='submitted'>{submitted}</output></main>}
const path=location.pathname;createRoot(document.getElementById('root')).render(path==='/feed'?<Feed/>:path==='/overwrite'?<Overwrite groupId='test-group' groupName='测试分组' onClose={()=>{}} onSaved={()=>{throw Error('No mutation allowed')}}/>:path==='/home'?<KeywordSearchCard/>:<Demo/>);`
const bundle=await build({stdin:{contents:entry,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'fixtures',setup(b){
 b.onResolve({filter:/^(next\/|@\/lib\/)/},args=>stubs[args.path]?{path:args.path,namespace:'fixture'}:undefined)
 b.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:stubs[args.path],loader:'jsx',resolveDir:process.cwd()}))
 b.onLoad({filter:/app[\\/]\(dashboard\)[\\/]page\.tsx$/},()=>({contents:readFileSync('app/(dashboard)/page.tsx','utf8')+'\nexport { KeywordSearchCard };',loader:'tsx',resolveDir:resolve('app/(dashboard)')}))
}}]})
const css=(await postcss([tailwindcss({content:['components/page-number-input.tsx','components/simple-pagination.tsx','components/content-feed-tab.tsx','components/submission-overwrite-dialog.tsx','components/app-dialog.tsx','app/(dashboard)/page.tsx']})]).process('@tailwind base;@tailwind utilities;@media(pointer:coarse){button,input,select{min-height:44px}}',{from:undefined})).css
const html=`<meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style><div id='root'></div><script>${bundle.outputFiles[0].text.replaceAll('</script','<\\/script')}</script>`
const browser=await chromium.launch({headless:true}),requests=[],errors=[]
try{
 const page=await browser.newPage({viewport:{width:1100,height:900}})
 page.setDefaultTimeout(8000)
 page.on('pageerror',error=>errors.push(error.message))
 await page.route('**/*',async route=>{
  const req=route.request(),url=new URL(req.url()),p=url.searchParams
  assert.equal(req.method(),'GET','Pagination must never submit a mutation')
  if(!url.pathname.startsWith('/api/'))return route.fulfill({contentType:'text/html',body:html})
  requests.push({path:url.pathname,params:Object.fromEntries(p)})
  const pg=Number(p.get('page')||0)
  let body={}
  if(url.pathname==='/api/content-feed')body={total:900,totalPages:45,page:pg,pageSize:20,items:[{id:'feed-'+pg,source:'bilibili',category:'video',title:'feed-page-'+pg,url:'https://example.com/video',coverUrl:null,author:'test',summary:null,publishedAt:null,firstSeenAt:'2026-10-19T00:00:00Z'}]}
  else if(url.pathname==='/api/keyword-volume')body={total:10000,keywords:[{keyword:'home-page-'+pg,volume:100}]}
  else if(url.pathname.includes('/submission-overwrite'))body=p.has('claimId')?{total:2000,rows:[{id:'history-'+pg,old_keyword:'history-page-'+pg,old_final_keyword:null,new_keyword:'new',old_username:'test',old_submitted_at:'2026-10-18',actor_name:'test',overwritten_at:'2026-10-19'}]}:
   {total:2000,actorName:'test',rows:[{id:'record-'+pg,keyword:'record-page-'+pg,final_keyword:null,username:'test',page_url:'https://example.com/page',source:'手动添加',operation_type:'更新',submitted_at:'2026-10-18',claimed_date:'2026-10-18',version:'fixture'}]}
  else throw Error('Unexpected API '+url.pathname)
  await route.fulfill({contentType:'application/json',body:JSON.stringify(body)})
 })
 const input=()=>page.getByLabel('跳转页码',{exact:true})
 const calls=async()=>JSON.parse(await page.locator('#calls').textContent())
 const visible=async text=>page.getByText(text,{exact:true}).waitFor({state:'visible'})
 await page.goto('https://pagination.test/shared');await input().waitFor()
 await input().fill('10234');assert.deepEqual(await calls(),[])
 await input().press('Enter');assert.deepEqual(await calls(),[10233])
 assert.equal(await page.locator('#submitted').textContent(),'0')
 await input().press('Enter');assert.deepEqual(await calls(),[10233])
 for(const text of ['','bad','1.5','-2']){await input().fill(text);await input().press('Enter');assert.equal(await input().inputValue(),'10234')}
 await input().fill('55');await input().press('Escape');assert.equal(await input().inputValue(),'10234')
 await input().fill('123');await page.locator('#submitted').click();assert.equal(await input().inputValue(),'10234')
 await input().fill('0');await input().press('Enter');assert.equal(await input().inputValue(),'1')
 await input().fill('9999999');await input().press('Enter');assert.equal(await input().inputValue(),'12500')
 await page.getByRole('button',{name:'缩小筛选'}).click();assert.equal(await input().inputValue(),'1')
 await input().fill('999');await input().press('Enter');assert.equal(await input().inputValue(),'2')
 await page.getByRole('button',{name:'切换加载'}).click();assert.equal(await input().isDisabled(),true)
 await page.getByRole('button',{name:'切换加载'}).click()
 await page.setViewportSize({width:375,height:812});await page.emulateMedia({reducedMotion:'reduce'})
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
 await page.screenshot({path:'.task-work/pagination-input-mobile.png'})
 const touch=await browser.newContext({viewport:{width:375,height:812},hasTouch:true,isMobile:true})
 const touchPage=await touch.newPage();await touchPage.setContent(html)
 assert.ok((await touchPage.getByLabel('跳转页码',{exact:true}).boundingBox()).height>=44)
 await touch.close()
 console.log(JSON.stringify({sharedControl:true,explicitEnterOnly:true,noFormSubmit:true,invalidRestored:true,escapeAndBlurCancel:true,clampedBounds:true,filtersReset:true,disabled:true,mobile375:true,coarsePointer44:true}))

 await page.setViewportSize({width:1100,height:900});await page.goto('https://pagination.test/feed');await visible('feed-page-1')
 await page.getByRole('tab',{name:'B站',exact:true}).click();await visible('feed-page-1')
 await input().waitFor({state:'visible'})
 const beforeFeed=requests.length;await input().fill('23');assert.equal(requests.length,beforeFeed)
 await input().press('Enter');await visible('feed-page-23')
 assert.equal(requests.length,beforeFeed+1)
 assert.equal(requests.at(-1).params.page,'23');assert.equal(requests.at(-1).params.sources,'bilibili');assert.equal(requests.at(-1).params.pageSize,'20')

 await page.goto('https://pagination.test/home');await page.getByPlaceholder('搜索词...').fill('original query')
 await page.getByRole('button',{name:'搜索',exact:true}).click();await visible('home-page-0')
 const beforeHome=requests.length;await input().fill('101');await input().press('Enter');await visible('home-page-100')
 assert.equal(requests.length,beforeHome+1);assert.equal(requests.at(-1).params.q,'original query')

 await page.goto('https://pagination.test/overwrite');await page.getByLabel('查找页面链接',{exact:true}).fill('https://example.com/page')
 await page.getByRole('button',{name:'查找',exact:true}).click();await visible('record-page-0')
 const beforeLookup=requests.length;await input().fill('8');await input().press('Enter');await visible('record-page-7')
 assert.equal(requests.length,beforeLookup+1);assert.equal(requests.at(-1).params.url,'https://example.com/page')
 await page.getByRole('radio').first().check();await page.getByRole('button',{name:'覆盖历史',exact:true}).click();await visible('history-page-0 → new')
 await input().nth(1).fill('6');await input().nth(1).press('Enter');await visible('history-page-5 → new')
 assert.equal(requests.at(-1).params.page,'5');assert.equal(requests.at(-1).params.claimId,'record-7')
 await input().nth(1).fill('2');await input().nth(1).press('Escape');assert.equal(await input().nth(1).inputValue(),'6')
 assert.ok(await page.getByRole('dialog').isVisible())
 assert.deepEqual(errors,[])
 console.log(JSON.stringify({contentFeedOneBased:true,homepageSearchZeroBased:true,overwriteLookupAndHistory:true,preservedFilters:true,onlyTargetPageRead:true,browserErrors:errors,productionWrites:0}))
}finally{await browser.close()}
