// 项目负责人账号。需要由本人维护的高权限功能统一引用这里，
// 避免相同 UUID 分散在前端与 API 中。
export const PROJECT_OWNER_ID = '294f63a9-7c06-455f-9896-0fbc6344cee5'

export function isProjectOwner(userId: string | null | undefined): boolean {
  return userId === PROJECT_OWNER_ID
}
