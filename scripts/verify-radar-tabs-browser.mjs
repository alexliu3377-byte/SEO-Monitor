// Actual dashboard components with read-only, in-memory HTTP/auth fixtures.
// No production sign-in, task mutation, or database writes.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { build } from 'esbuild'
import { chromium } from 'playwright'
import postcss from 'postcss'
import tailwindcss from 'tailwindcss'

const beforeRef=process.argv.find(value=>value.startsWith('--before='))?.slice(9)
if(beforeRef&&!/^[a-f0-9]{7,40}$/i.test(beforeRef))throw Error('--before requires a commit SHA')
const before=!!beforeRef
const group='33333333-3333-4333-8333-333333333333', user='44444444-4444-4444-8444-444444444444'
const date=offset=>new Date(Date.now()+8*3600000+offset*86400000).toISOString().slice(0,10)
const fakeDb=`const result={data:[],error:null}; const q=new Proxy(function(){return q},{get:(_,k)=>k==='then'?Promise.resolve(result).then.bind(Promise.resolve(result)):()=>q,apply:()=>q});const db={from:()=>q,rpc:async()=>result,channel:()=>q,removeChannel:()=>{}};export const getBrowserClient=()=>db;`
const stubs={
  '@/lib/user-context':`export const useUser=()=>({id:'${user}',role:'super'});`,
  '@/lib/supabase-browser':fakeDb,'@/lib/supabase':fakeDb,
  'next/navigation':`const router={push:()=>{},replace:()=>{}};export const useRouter=()=>router;`,
  'next/link':`import React from 'react';export default function Link({href,children,...props}){return React.createElement('a',{href,...props},children)}`,
  '@/components/baidu-cookie-pool':`export const BaiduCookiePoolManager=()=>null;`,
}
const bundle=await build({stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';import Task from './app/(dashboard)/task-groups/page';import Radar from './app/(dashboard)/hot-keywords/page';createRoot(document.getElementById('root')).render(location.pathname==='/task'?<Task groupId="${group}"/>:<Radar/>);`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'fixtures',setup(b){
  b.onResolve({filter:/^(next\/|@\/lib\/|@\/components\/)/},args=>stubs[args.path]?{path:args.path,namespace:'fixture'}:undefined)
  b.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:stubs[args.path],loader:'jsx',resolveDir:process.cwd()}))
  if(before)b.onLoad({filter:/app[\\/]\(dashboard\)[\\/]task-groups[\\/]page\.tsx$/},()=>({contents:execFileSync('git',['show',`${beforeRef}:app/(dashboard)/task-groups/page.tsx`],{encoding:'utf8'}),loader:'tsx',resolveDir:resolve('app/(dashboard)/task-groups')}))
}}]})
const css=(await postcss([tailwindcss({content:['app/(dashboard)/task-groups/page.tsx','app/(dashboard)/hot-keywords/page.tsx','components/volume-rise-date-cell.tsx']})]).process('@tailwind base;@tailwind utilities;',{from:undefined})).css
const html=`<style>${css}</style><div id="root"></div><script>${bundle.outputFiles[0].text.replaceAll('</script','<\\/script')}</script>`
const browser=await chromium.launch({headless:true})
const requests=[], errors=[]
let failTab='',delayTab=''
try{
 const page=await browser.newPage({viewport:{width:1440,height:1000}})
 page.on('pageerror',error=>errors.push(error.message))
 await page.route('**/*',async route=>{
  const req=route.request(),url=new URL(req.url())
  assert.equal(req.method(),'GET','Browser fixtures must never mutate data')
  if(!url.pathname.startsWith('/api/'))return route.fulfill({contentType:'text/html',body:html})
  let body={rows:[],total:0}
  if(url.pathname==='/api/task-groups')body={groups:[{id:group,name:'测试工作台',type:'all',members:[{user_id:user,username:'测试组员'}],rank_domains:[],new_domains:[],associated_domains:[],site_domains:['a.com']}]}
  else if(url.pathname.endsWith('/claimed'))body={keywords:[]}
  else if(url.pathname.endsWith('/rankdown-signals'))body={rows:[{keyword:'独立跌词',stat_date:date(0),rank_position:3,prev_rank:1,volume:100,url:'https://a.com/1.html'}]}
  else if(url.pathname==='/api/radar-daily'){
   const p=url.searchParams,tab=p.get('tab'),day=p.get('date'),pg=Number(p.get('page')),size=Number(p.get('pageSize')),total=tab==='rank'?2505:42
   requests.push({tab,date:day,page:pg,size})
   if(tab===delayTab)await new Promise(r=>setTimeout(r,700))
   if(tab===failTab)return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'测试该来源暂时不可用'})}).catch(()=>{})
   body={date:day,total,data:Array.from({length:Math.max(0,Math.min(size,total-pg*size))},(_,i)=>({keyword:`${tab}|${day}|${pg*size+i}`,volume:100,prevVolume:90,change:10,baselineVolume:50,netChange:50,siteCount:2,count:2,sites:['a.com','b.com'],first_date:day,last_date:day,rankDays:3,streak:3,domain:'a.com',dims:['new','rank'],newSites:['a.com'],rankSites:['b.com'],long_tail_count:3,site_count:2}))}
  }
  await route.fulfill({contentType:'application/json',body:JSON.stringify(body)}).catch(()=>{})
 })
 const visible=async text=>{await page.getByText(text,{exact:true}).first().waitFor({state:'visible',timeout:4000}).catch(async error=>{console.error(JSON.stringify({errors,recentRequests:requests.slice(-8),body:(await page.locator('body').innerText()).slice(0,1600)}));throw error})}
 const choose=async label=>page.getByRole('button',{name:label,exact:true}).click()
 await page.goto('https://radar.test/task')
 await choose('更新词库')
 if(before){
  let blocked=false
  try{await visible(`wordLib|${date(-1)}|0`)}catch{blocked=true}
  assert.ok(blocked,'Pre-fix component should reproduce the first-entry loading gate')
  assert.ok(requests.some(r=>r.tab==='wordLib'),'The word library API itself did return data')
  console.log(JSON.stringify({beforeFix:true,reproduced:'wordLib API succeeds but unrelated radarLoaded gate blocks render'}))
 }else{
  await visible(`wordLib|${date(-1)}|0`)
  await page.getByLabel('筛选资料日期').selectOption(date(-2));await visible(`wordLib|${date(-2)}|0`)
  delayTab='rank';await choose('竞品涨排名');await choose('更新词库');await visible(`wordLib|${date(-2)}|0`)
  await page.waitForTimeout(850);await visible(`wordLib|${date(-2)}|0`);delayTab=''
  await choose('竞品涨排名');await visible(`rank|${date(0)}|0`)
  await page.getByLabel('筛选资料日期').selectOption(date(-3));await visible(`rank|${date(-3)}|0`)
  await choose('更新词库');assert.equal(await page.getByLabel('筛选资料日期').inputValue(),date(-2))
  await visible(`wordLib|${date(-2)}|0`);await choose('下一页');await visible(`wordLib|${date(-2)}|20`)
  await choose('竞品涨排名');assert.equal(await page.getByLabel('筛选资料日期').inputValue(),date(-3));await visible(`rank|${date(-3)}|0`)
  failTab='cross';await choose('交叉词');await visible('该日期资料读取失败，请点击上方重试或切换日期。')
  await choose('更新词库');await visible(`wordLib|${date(-2)}|0`);failTab=''
  await choose('跌词更新');await visible('独立跌词')
  await page.screenshot({path:'.task-work/radar-tabs-fixed.png'})
  console.log(JSON.stringify({taskWorkspace:true,wordLibFirstEntry:true,datesIndependent:true,lateResponsesIsolated:true,pagination:true,failureIsolated:true,rankdownIndependent:true}))
  await page.goto('https://radar.test/radar');await visible(`volumeRising|${date(0)}|0`)
  await choose('更新词库');await visible(`wordLib|${date(-1)}|0`)
  await page.getByLabel('筛选资料日期').selectOption(date(-2));await visible(`wordLib|${date(-2)}|0`)
  await choose('竞品涨排名');await visible(`rank|${date(0)}|0`)
  await choose('»');await visible(`rank|${date(0)}|2500`)
  await choose('更新词库');assert.equal(await page.getByLabel('筛选资料日期').inputValue(),date(-2));await visible(`wordLib|${date(-2)}|0`)
  failTab='cross';await choose('交叉词');await visible('测试该来源暂时不可用');assert.ok(await page.getByLabel('筛选资料日期').isVisible())
  failTab='';await choose('重试');await visible(`cross|${date(0)}|0`)
  assert.deepEqual(errors,[])
  console.log(JSON.stringify({hotRadar:true,pageBeyond2000:true,datesIndependent:true,filtersSurviveFailure:true,retry:true,browserErrors:errors,requests:requests.length,productionWrites:0}))
 }
}finally{await browser.close()}
