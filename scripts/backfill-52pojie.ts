// Explicit, bounded recovery. Dry run by default; never backdate discovery time.
import {createClient} from '@supabase/supabase-js'
import {contentFeedDatabaseRows,fetchContentFeedSource} from '../lib/content-feed'

async function main(){
 const args=process.argv.slice(2)
 const flag=(name:string)=>{const index=args.indexOf(name);return index>=0?args[index+1]:undefined}
 const fromDate=flag('--from-date'),toDate=flag('--to-date')
 if(!fromDate||!toDate)throw Error('Provide --from-date YYYY-MM-DD --to-date YYYY-MM-DD; add --write to import')
 const result=await fetchContentFeedSource('52pojie',{fromDate,toDate,maxPages:Number(flag('--pages')||8)})
 const byDate:Record<string,number>={},categories:Record<string,number>={}
 for(const item of result.items){const day=new Date(Date.parse(item.publishedAt!)+8*3600000).toISOString().slice(0,10);byDate[day]=(byDate[day]||0)+1;categories[item.sourceCategory||'unknown']=(categories[item.sourceCategory||'unknown']||0)+1}
 console.log(JSON.stringify({source:'52pojie',fromDate,toDate,collected:result.items.length,byDate,categories,warnings:result.warnings}))
 if(result.warnings.length)throw Error('Requested date coverage is incomplete; no items were imported')
 if(!args.includes('--write')){console.log('Dry run only; no database writes');return}
 const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY
 if(!url||!key)throw Error('Missing Supabase environment configuration')
 const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}})
 const rows=contentFeedDatabaseRows(result.items,new Date().toISOString())
 // Existing titles/URLs can be normalized, but stable source IDs prevent duplicates.
 for(let i=0;i<rows.length;i+=100){const {error}=await db.from('content_feed_items').upsert(rows.slice(i,i+100),{onConflict:'source,source_id'});if(error)throw Error(error.code+': '+error.message)}
 console.log(JSON.stringify({source:'52pojie',accepted:rows.length,firstSeenPreserved:true,publishedDatesPreserved:true}))
}
main().catch(error=>{console.error(error instanceof Error?error.message:String(error));process.exitCode=1})
