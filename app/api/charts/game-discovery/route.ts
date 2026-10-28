import { NextResponse } from 'next/server'
import { getContentCaller } from '@/lib/content-access-server'
import { GAME_DISCOVERY_SOURCES, isGameDiscoveryDataset } from '@/lib/game-discovery-sources'

export async function GET(request: Request) {
  const { caller, service }=await getContentCaller()
  if (!caller) return NextResponse.json({error:'Unauthorized'},{status:401})
  const params=new URL(request.url).searchParams, dataset=params.get('dataset'), page=Number(params.get('page') || '1')
  if (!isGameDiscoveryDataset(dataset) || !Number.isInteger(page) || page<1 || page>5) return NextResponse.json({error:'资料类型或页码无效'},{status:400})
  const config=GAME_DISCOVERY_SOURCES[dataset]
  const {data,error}=await service.rpc('get_game_discovery_page',{p_dataset:dataset,p_page:page})
  if (error) return NextResponse.json({error:'来源资料暂时无法读取，请稍后重试'},{status:503})
  return NextResponse.json({...data,sourceUrl:config.url},{headers:{'Cache-Control':'private, max-age=30'}})
}
