// 首页快报"导出今日/导出全部"（关键词搜索量）——2026-09-03 用户明确要求
// 只有自己能用，其它 super 账号（比如 timura）也不行。之前的权限判断是
// role==='super'，现在收紧到硬编码这一个 user_profiles.id。前端按钮显示、
// 身份验证接口、导出接口三处都要引用同一个常量，不要分别硬编码同一个UUID。
// 没有服务端专属依赖，client/server 组件都能安全导入。
export const KEYWORD_EXPORT_OWNER_ID = '294f63a9-7c06-455f-9896-0fbc6344cee5'
export type ExportVerificationPurpose = 'keyword-volume' | 'rank-history'

export function isKeywordExportOwner(userId: string | null | undefined): boolean {
  return userId === KEYWORD_EXPORT_OWNER_ID
}

export function isExportVerificationPurpose(value: unknown): value is ExportVerificationPurpose {
  return value === 'keyword-volume' || value === 'rank-history'
}

export function canVerifyExportPurpose(
  userId: string | null | undefined,
  role: string | null | undefined,
  purpose: ExportVerificationPurpose
): boolean {
  return purpose === 'keyword-volume' ? isKeywordExportOwner(userId) : role === 'super'
}
