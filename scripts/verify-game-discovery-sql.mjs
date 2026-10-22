import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {pathToFileURL} from 'node:url'
const {PGlite}=await import(process.env.PGLITE_MODULE_PATH?pathToFileURL(process.env.PGLITE_MODULE_PATH).href:'@electric-sql/pglite')
const db=new PGlite()
const rows=n=>Array.from({length:n},(_,i)=>({position:i+1,sourceId:String(i+1),title:'游戏'+i,summary:null,url:null,metric:null,change:null,tags:[]}))
try{
 await db.exec('create role anon;create role authenticated;create role service_role;')
 await db.exec(await readFile(new URL('../supabase/migrations/20261021_game_discovery_sources.sql',import.meta.url),'utf8'))
 await db.exec(await readFile(new URL('../supabase/migrations/20261022_momorank_platform_views.sql',import.meta.url),'utf8'))
 const call=(dataset,date,time,items)=>db.query('select replace_game_discovery_cache($1,$2::date,$3::timestamptz,null,$4::jsonb) as accepted',[dataset,date,time,JSON.stringify(items)])
 assert.equal((await call('momo_hot_words','2020-10-20','2020-10-21T00:00:00Z',rows(10))).rows[0].accepted,10)
 await assert.rejects(call('momo_hot_words','2020-10-21','2020-10-22T00:00:00Z',rows(11)))
 await assert.rejects(call('momo_hot_words',null,'2020-10-22T00:00:00Z',rows(10)))
 await assert.rejects(call('momo_hot_words','2020-10-21','2020-10-22T00:00:00Z',rows(10).map(row=>({...row,title:''}))))
 assert.equal((await call('momo_hot_words','2020-10-19','2020-10-22T00:00:00Z',rows(2))).rows[0].accepted,0,'Older source dates must not overwrite a newer source snapshot')
 const state=(await db.query("select source_date::text,item_count from game_discovery_cache where dataset='momo_hot_words'")).rows[0]
 assert.equal(state.source_date,'2020-10-20');assert.equal(state.item_count,10)
 const wechat=rows(100).map(row=>({...row,sourceId:`wx${row.position.toString(16).padStart(16,'0')}`}))
 assert.equal((await call('wechat_popularity',null,'2020-10-21T00:00:00Z',wechat)).rows[0].accepted,100)
 await assert.rejects(call('wechat_popularity','2020-10-21','2020-10-22T00:00:00Z',wechat))
 const page=(await db.query("select position from game_discovery_cache_rows where dataset='wechat_popularity' order by position offset 60 limit 20")).rows
 assert.equal(page.length,20);assert.equal(page[0].position,61);assert.equal(page.at(-1).position,80)
 const result=(await db.query("select get_game_discovery_page('wechat_popularity',4) as payload")).rows[0].payload
 assert.equal(result.metadata.source_date,null);assert.equal(result.total,100);assert.equal(result.items.length,20);assert.equal(result.items[0].position,61)
 assert.equal((await db.query("select get_game_discovery_page('momo_hot_words',1) as payload")).rows[0].payload.metadata.source_date,'2020-10-20')
 await assert.rejects(db.query("select get_game_discovery_page('momo_hot_words',0)"))
 const rights=(await db.query("select has_function_privilege('authenticated','replace_game_discovery_cache(text,date,timestamptz,timestamptz,jsonb)','EXECUTE') as browser")).rows[0]
 assert.equal(rights.browser,false)
 const highlights={changes:[{label:'上升',items:[{title:'游戏',url:'https://www.momorank.com/douyin/games/1',change:'+3'}]}],rising:[]}
 const v2=(dataset,date,time,items,extra=highlights)=>db.query('select replace_game_discovery_cache_v2($1,$2::date,$3::timestamptz,null,$4::jsonb,$5::jsonb) as accepted',[dataset,date,time,JSON.stringify(items),JSON.stringify(extra)])
 const douyin=rows(10).map(row=>({...row,url:`https://www.momorank.com/douyin/games/${row.position}`}))
 assert.equal((await v2('momo_douyin_publisher','2020-10-21','2020-10-22T00:00:00Z',douyin)).rows[0].accepted,10)
 const published=(await db.query("select get_game_discovery_page('momo_douyin_publisher',1) as payload")).rows[0].payload
 assert.deepEqual(published.metadata.highlights,highlights);assert.equal(published.items.length,10)
 await assert.rejects(v2('momo_douyin_publisher','2020-10-22','2020-10-23T00:00:00Z',douyin,{changes:[{label:'上升',items:[{title:'坏链接',url:'https://evil.test/',change:'+1'}]}],rising:[]}))
 await assert.rejects(v2('momo_bestseller','2020-10-21','2020-10-22T00:00:00Z',douyin))
 await assert.rejects(v2('momo_douyin_publisher','2020-10-22','2020-10-23T00:00:00Z',douyin.map(row=>({...row,title:''}))))
 assert.deepEqual((await db.query("select get_game_discovery_page('momo_douyin_publisher',1) as payload")).rows[0].payload,published,'Failed rows/summary must preserve the entire previous snapshot')
 assert.equal((await v2('momo_douyin_publisher','2020-10-20','2020-10-23T00:00:00Z',douyin)).rows[0].accepted,0)
 assert.equal((await db.query("select has_function_privilege('anon','replace_game_discovery_cache_v2(text,date,timestamptz,timestamptz,jsonb,jsonb)','EXECUTE') as browser")).rows[0].browser,false)
 console.log(JSON.stringify({atomicPublishing:true,rowsAndHighlightsSameSnapshot:true,platformIsolation:true,sourceDatesSeparate:true,unknownWechatFreshness:true,noPaidRows:true,olderSourceIgnored:true,sqlPaging20:true,serviceOnlyWrites:true,productionWrites:0}))
}finally{await db.close()}
