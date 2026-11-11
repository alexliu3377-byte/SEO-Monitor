import { createServiceClient } from '@/lib/supabase-server'
import { createWordFeedHandler, loadWordFeed } from '@/lib/agent-word-feed'

// 奇心 Agent 推荐词（只读）：热词雷达 + 竞品日收。只认专用密钥 AGENT_WORD_FEED_SECRET，没设置时接口关闭。
export const maxDuration = 30
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  return createWordFeedHandler({
    secret: process.env.AGENT_WORD_FEED_SECRET,
    load: date => loadWordFeed(createServiceClient(), date),
  })(req)
}
