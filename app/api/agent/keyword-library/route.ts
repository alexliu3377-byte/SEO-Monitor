import { createKeywordLibraryHandler, type KeywordLibraryService } from '@/lib/agent-keyword-library'
import { createServiceClient } from '@/lib/supabase-server'

export const maxDuration = 20
export const dynamic = 'force-dynamic'

// 奇心 Agent 服务器取词用：只读、专用密钥（KEYWORD_LIBRARY_FEED_KEY，至少 24 位；也认已有的 AGENT_WORD_FEED_SECRET），不走登录会话。
export const GET = createKeywordLibraryHandler({
  getService: () => createServiceClient() as unknown as KeywordLibraryService,
  getKeys: () => [process.env.KEYWORD_LIBRARY_FEED_KEY, process.env.AGENT_WORD_FEED_SECRET],
})
