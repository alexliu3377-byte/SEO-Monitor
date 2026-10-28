import { getContentCaller } from '@/lib/content-access-server'
import { createAgentMaterialExportHandler } from '@/lib/content-agent-materials-http'

export const maxDuration = 15
export const dynamic = 'force-dynamic'

// Owner-only, explicitly selected, read-only snapshots. No model calls or background work on Vercel.
export const GET = createAgentMaterialExportHandler(getContentCaller)
