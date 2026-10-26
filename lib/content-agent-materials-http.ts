import { loadAgentMaterialBundle, mayExportAgentMaterials, parseAgentMaterialIds } from './content-agent-materials'

type ExportContext = {
  caller: { role: string; isOwner: boolean } | null
  service: Parameters<typeof loadAgentMaterialBundle>[0]
}
const headers = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' }

export function createAgentMaterialExportHandler(getContext: () => Promise<ExportContext>) {
  return async function GET(request: Request) {
    const { caller, service } = await getContext()
    if (!caller) return Response.json({ error: 'Unauthorized' }, { status: 401, headers })
    if (!mayExportAgentMaterials(caller)) return Response.json({ error: '仅限项目负责人本地试用' }, { status: 403, headers })
    let ids: string[]
    try { ids = parseAgentMaterialIds(new URL(request.url).searchParams.get('ids')) }
    catch { return Response.json({ error: '请选择 1 至 8 个不重复的内容资料编号' }, { status: 400, headers }) }
    try {
      const bundle = await loadAgentMaterialBundle(service, ids)
      return Response.json(bundle, { headers: { ...headers, 'Content-Disposition': 'attachment; filename="qixin-agent-materials.json"' } })
    } catch {
      return Response.json({ error: '资料包生成失败，请检查所选资料及已保存文字；未调用模型' }, { status: 503, headers })
    }
  }
}
