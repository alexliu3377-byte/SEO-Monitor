import { NextResponse } from 'next/server'
import { authorizeContentCollector } from '@/lib/content-access-server'
import { createServiceClient } from '@/lib/supabase-server'
import { validateGameDiscoveryCollection } from '@/lib/game-discovery-sources'

export async function POST(request: Request) {
  const authorization=authorizeContentCollector(request)
  if (!authorization.ok) return NextResponse.json({error:'来源采集认证未通过'},{status:authorization.missingConfiguration?503:401})
  if (Number(request.headers.get('content-length'))>250_000) return NextResponse.json({error:'资料超过大小限制'},{status:413})
  let collection
  try {
    const raw=await request.text()
    if (new TextEncoder().encode(raw).length>250_000) return NextResponse.json({error:'资料超过大小限制'},{status:413})
    collection=validateGameDiscoveryCollection(JSON.parse(raw))
  } catch { return NextResponse.json({error:'来源资料无效或不完整'},{status:400}) }
  const service=createServiceClient() as any
  const {data,error}=await service.rpc('replace_game_discovery_cache_v2',{p_dataset:collection.dataset,p_source_date:collection.sourceDate,
    p_collected_at:collection.collectedAt,p_source_modified_at:collection.sourceModifiedAt,p_items:collection.items,p_highlights:collection.highlights})
  if (error) return NextResponse.json({error:'来源资料保存失败，保留已有资料'},{status:500})
  return NextResponse.json({accepted:data,ignored:data===0})
}
