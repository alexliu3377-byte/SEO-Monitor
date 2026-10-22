import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { DiscoverySourceBlocked, fetchGameDiscoveryDataset } from '../lib/game-discovery-collector'
import { GAME_DISCOVERY_SOURCES, isGameDiscoveryDataset, type GameDiscoveryDataset } from '../lib/game-discovery-sources'

async function main() {
  const args=process.argv.slice(2), sourceIndex=args.indexOf('--source'), datasetIndex=args.indexOf('--dataset')
  const source=sourceIndex>=0?args[sourceIndex+1]:null, dataset=datasetIndex>=0?args[datasetIndex+1]:null, write=args.includes('--write')
  if (!['momorank','wechat'].includes(source || '') || (dataset!==null && (!isGameDiscoveryDataset(dataset) || GAME_DISCOVERY_SOURCES[dataset].provider!==source))) throw new Error('使用 --source momorank 或 --source wechat；可选 --dataset 已支持的类型、--write')
  const allowed=new Set([sourceIndex,sourceIndex+1,...(datasetIndex>=0?[datasetIndex,datasetIndex+1]:[]),args.indexOf('--write')])
  if (args.some((_,index)=>!allowed.has(index))) throw new Error('不支持的采集参数')
  const envPath=resolve(process.env.TREND_ENV_FILE || '.env.trend.local')
  if(existsSync(envPath))for(const line of readFileSync(envPath,'utf8').split(/\r?\n/)){
    const match=line.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/)
    if(match&&!process.env[match[1]])process.env[match[1]]=match[2].replace(/^(['"])(.*)\1$/,'$2')
  }
  const base=process.env.TREND_INGEST_URL?.trim(),secret=process.env.TREND_INGEST_SECRET?.trim()
  if(write&&(!base||!secret))throw new Error('TREND_INGEST_URL / TREND_INGEST_SECRET 未配置')
  const datasets=(Object.keys(GAME_DISCOVERY_SOURCES) as GameDiscoveryDataset[]).filter(key=>GAME_DISCOVERY_SOURCES[key].provider===source&&(!dataset||key===dataset))
  let failed=false
  for(let index=0;index<datasets.length;index++){
    const key=datasets[index]
    if(index)await new Promise(resolve=>setTimeout(resolve,8000))
    try{
      const result=await fetchGameDiscoveryDataset(key)
      if(!write){console.log(JSON.stringify({dryRun:true,dataset:key,sourceDate:result.sourceDate,sourceModifiedAt:result.sourceModifiedAt,count:result.items.length,first:result.items[0]}));continue}
      const response=await fetch(new URL('/api/charts/game-discovery/ingest',new URL(base!).origin),{
        method:'POST',headers:{Authorization:`Bearer ${secret}`,'Content-Type':'application/json'},body:JSON.stringify(result),redirect:'error',signal:AbortSignal.timeout(60000),
      })
      const data=await response.json().catch(()=>null)
      if(!response.ok)throw new DiscoverySourceBlocked(`后台入库失败 HTTP ${response.status}，停止后续采集；${data?.error||'无效响应'}`)
      if(!response.ok||!Number.isInteger(data?.accepted)||(data.accepted!==result.items.length&&!(data.accepted===0&&data.ignored===true)))throw new Error(`入库失败 HTTP ${response.status}：${data?.error||'无效响应'}`)
      console.log(JSON.stringify({dataset:key,sourceDate:result.sourceDate,...data}))
    }catch(error){failed=true;console.error(`${key}: ${error instanceof Error?error.message:'采集失败'}`);if(error instanceof DiscoverySourceBlocked)break}
  }
  if(failed)process.exitCode=1
}
main().catch(error=>{console.error(error instanceof Error?error.message:error);process.exitCode=1})
