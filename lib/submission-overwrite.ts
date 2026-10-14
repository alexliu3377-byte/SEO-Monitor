export const OVERWRITE_PAGE_SIZE = 20
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export interface OverwriteCandidate {
  id: string
  keyword: string
  final_keyword: string | null
  page_url: string
  user_id: string
  username: string
  source: string | null
  operation_type: string | null
  submitted_at: string | null
  claimed_date: string
  search_volume: number
  version: string
}

export interface SubmissionOverwriteHistory {
  id: string
  old_keyword: string
  old_final_keyword: string | null
  old_username: string
  old_submitted_at: string | null
  new_keyword: string
  actor_name: string
  overwritten_at: string
}

// Lookup only; the original stored URL is never changed by an overwrite.
export function validateOverwriteUrl(input: unknown): string {
  if (typeof input !== 'string' || !input.trim() || input.trim().length > 2048) throw new Error('请填写有效的完整页面链接')
  const value = input.trim()
  if (/^\d+$/.test(value)) throw new Error('请填写完整页面链接，不能只填写数字 ID')
  if (/\s/.test(value) || (/^[a-z][a-z\d+.-]*:/i.test(value) && !/^https?:\/\//i.test(value))) throw new Error('链接仅支持 http 或 https')
  let url: URL
  try { url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`) } catch { throw new Error('页面链接格式不正确') }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || !url.hostname.includes('.')) throw new Error('请填写有效的页面链接，不要包含登录信息')
  // Preserve path casing, query strings, and encoded characters. These can
  // identify different pages even though protocol/www/m variants are equivalent.
  return value.replace(/#.*$/, '')
}

export function parseOverwriteRequest(body: unknown) {
  const input = body as Record<string, unknown> | null
  if (!input || typeof input !== 'object' || !UUID.test(String(input.claimId ?? ''))) throw new Error('提交记录编号无效')
  if (typeof input.version !== 'string' || !/^[a-f0-9]{32}$/.test(input.version)) throw new Error('请重新查找并选择要覆盖的记录')
  if (typeof input.keyword !== 'string') throw new Error('请填写覆盖词')
  const keyword = input.keyword.trim()
  if (!keyword || keyword.length > 200 || /[\u0000-\u001f\u007f]/.test(keyword)) throw new Error('覆盖词须为 1–200 字，不能包含换行或控制字符')
  // Ownership, source, dates, URL and volume are deliberately not accepted
  // from the client; the database derives every one of them.
  return { claimId: String(input.claimId), version: input.version, keyword }
}

export function overwriteError(error: { code?: string; message?: string }) {
  if (error.message?.includes('OVERWRITE_STALE')) return { status: 409, message: '这条提交已被修改，请重新查找后再覆盖' }
  if (error.message?.includes('OVERWRITE_NOT_FOUND')) return { status: 404, message: '找不到该分组内已提交的记录，请重新查找' }
  if (error.code === '42501') return { status: 403, message: '你没有这个分组的覆盖权限' }
  if (error.code === '23505') return { status: 409, message: '该覆盖词已有冲突的提交记录，请换词或先检查当天任务' }
  if (['42P01', '42883', 'PGRST202', 'PGRST205'].includes(error.code ?? '')) return { status: 503, message: '覆盖功能尚未启用，请联系管理员完成数据库更新' }
  return { status: 500, message: '覆盖处理失败，原记录未改动，请稍后重试' }
}
