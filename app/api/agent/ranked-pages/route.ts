import { createRankedPagesHandler, type RankedPagesService } from '@/lib/agent-ranked-pages'
import { createServiceClient } from '@/lib/supabase-server'

export const maxDuration = 30
export const dynamic = 'force-dynamic'

// 奇心 Agent 服务器取「排名词」用：只读、专用密钥（和词库补充同一套：KEYWORD_LIBRARY_FEED_KEY，也认 AGENT_WORD_FEED_SECRET），不走登录会话。
export const GET = createRankedPagesHandler({
  getService: () => createServiceClient() as unknown as RankedPagesService,
  getKeys: () => [process.env.KEYWORD_LIBRARY_FEED_KEY, process.env.AGENT_WORD_FEED_SECRET],
})
