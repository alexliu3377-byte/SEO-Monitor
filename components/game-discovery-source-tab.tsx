'use client'
import { useEffect, useState } from 'react'
import { SimplePagination } from './simple-pagination'
import { GAME_DISCOVERY_SOURCES, MOMORANK_DATASETS, WECHAT_DATASETS, type GameDiscoveryDataset } from '@/lib/game-discovery-sources'

type Row={position:number;source_id:string;title:string;summary:string|null;url:string|null;metric:string|null;change:string|null;tags:string[]}
type Data={items:Row[];total:number;metadata:{source_date:string|null;collected_at:string;source_modified_at:string|null}|null}
const EMPTY:Data={items:[],total:0,metadata:null}
function time(value:string) { return new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Kuala_Lumpur',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(value)) }

export default function GameDiscoverySourceTab({source}:{source:'momorank'|'wechat'|'hotwords'}) {
  const datasets=source==='wechat'?WECHAT_DATASETS:source==='hotwords'?['momo_hot_words'] as GameDiscoveryDataset[]:MOMORANK_DATASETS
  const [dataset,setDataset]=useState<GameDiscoveryDataset>(datasets[0]),[page,setPage]=useState(0),[retry,setRetry]=useState(0)
  const [data,setData]=useState<Data>(EMPTY),[loading,setLoading]=useState(true),[error,setError]=useState('')
  const total=data.total, config=GAME_DISCOVERY_SOURCES[dataset], compact=source==='hotwords'
  useEffect(()=>{
    const controller=new AbortController()
    setLoading(true);setError('');setData(EMPTY)
    fetch(`/api/charts/game-discovery?dataset=${dataset}&page=${page+1}`,{signal:controller.signal})
      .then(async response=>{const result=await response.json();if(!response.ok)throw new Error(result.error || '来源资料读取失败');if(!controller.signal.aborted)setData(result)})
      .catch(reason=>{if(!controller.signal.aborted)setError(reason instanceof Error?reason.message:'来源资料读取失败')})
      .finally(()=>{if(!controller.signal.aborted)setLoading(false)})
    return()=>controller.abort()
  },[dataset,page,retry])
  const title=compact?'MomoRank 热搜词':source==='wechat'?'微信小游戏':'MomoRank'
  const hasMetric=['momo_ip','momo_rising'].includes(dataset),hasChange=['momo_ip','momo_rising','momo_popularity','momo_bestseller','momo_bestplay'].includes(dataset)
  return <section className="overflow-hidden rounded-xl border border-slate-200 bg-white" aria-label={title}>
    <div className={`border-b px-5 py-3 ${compact?'border-teal-100 bg-teal-50':'border-slate-100'}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1"><h2 className="truncate text-sm font-semibold text-slate-900">{title}</h2><a href={config.url} target="_blank" rel="noopener noreferrer" aria-label={`打开${title}${compact?'':config.label}来源（新窗口）`} title="打开资料来源" className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-blue-600 hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11"><span aria-hidden="true">↗</span></a></div>
        {!compact && <label className="flex items-center gap-2 text-xs text-slate-600">资料类型<select aria-label={`${title}资料类型`} value={dataset} onChange={event=>{setDataset(event.target.value as GameDiscoveryDataset);setPage(0)}} className="h-8 rounded-md border border-slate-200 bg-white px-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 [@media(pointer:coarse)]:h-11">{datasets.map(key=><option key={key} value={key}>{GAME_DISCOVERY_SOURCES[key].label}</option>)}</select></label>}
      </div>
    </div>
    <div className="px-4 pt-2 text-xs leading-5 text-slate-500">
      <p>{config.note}</p>
      {config.provider==='momorank' && <p>仅采集免费公开前 10 条，不含原站付费资料。</p>}
      {data.metadata && <p>资料日期：{data.metadata.source_date?.replaceAll('-','/') || '未提供'} · 采集：{time(data.metadata.collected_at)}</p>}
      {source==='wechat' && data.metadata && <p role="status" className="text-amber-700">此为官网展示资料，不能确认是当天排名。{data.metadata.source_modified_at?`网页修改时间：${time(data.metadata.source_modified_at)}（非榜单日期）。`:''}</p>}
    </div>
    {error?<div role="alert" className="flex items-center justify-center gap-3 px-4 py-12 text-sm text-slate-600"><span>{error}</span><button type="button" className="btn-secondary whitespace-nowrap" onClick={()=>setRetry(value=>value+1)}>重试</button></div>
      :loading?<div role="status" className="px-4 py-16 text-center text-sm text-slate-500">正在读取资料…</div>
        :!data.items.length?<div role="status" className="px-4 py-16 text-center text-sm text-slate-500">{data.metadata?'当前页暂无资料':'尚未采集到此来源资料'}</div>
          :compact?<ol className="space-y-1 px-4 py-3">{data.items.map(row=><li key={row.source_id} className="flex items-center gap-2 border-b border-slate-50 py-2 text-sm"><span className="w-5 shrink-0 text-center text-xs tabular-nums text-slate-500">{row.position}</span><span title={row.title} className="truncate text-slate-900">{row.title}</span></li>)}</ol>
            :<><div className="mt-3 overflow-x-auto"><table className="w-full min-w-[600px] table-fixed text-left text-sm"><thead><tr className="bg-slate-50"><th scope="col" className="table-th w-16">{dataset==='momo_rising'?'序号':'排名'}</th><th scope="col" className="table-th w-1/4">{dataset==='momo_ip'?'IP 名称':'游戏名称'}</th>{hasMetric&&<th scope="col" className="table-th w-28">{dataset==='momo_ip'?'来源热度':'当前名次'}</th>}{hasChange&&<th scope="col" className="table-th w-20">{dataset==='momo_rising'?'日升降':'变化'}</th>}<th scope="col" className="table-th">简介／补充</th></tr></thead><tbody>{data.items.map(row=><tr key={row.source_id} className="border-t border-slate-100 hover:bg-slate-50"><td className="table-td tabular-nums text-slate-500">{row.position}</td><td className="table-td">{row.url?<a href={row.url} target="_blank" rel="noopener noreferrer" title={row.title} className="block truncate text-blue-600 hover:underline">{row.title}</a>:<span title={row.title} className="block truncate font-medium text-slate-900">{row.title}</span>}</td>{hasMetric&&<td className="table-td tabular-nums"><span title={row.metric||undefined} className="block truncate">{row.metric||'—'}</span></td>}{hasChange&&<td className="table-td tabular-nums"><span title={row.change||undefined} className="block truncate">{row.change||'—'}</span></td>}<td className="table-td"><span title={[row.summary,...row.tags].filter(Boolean).join(' · ')} className="block truncate text-slate-500">{[row.summary,...row.tags].filter(Boolean).join(' · ')||'—'}</span></td></tr>)}</tbody></table></div><SimplePagination page={page} total={total} disabled={loading} onChange={setPage}/></>}
  </section>
}
