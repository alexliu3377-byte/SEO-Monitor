// 覆盖 is a distinct operation, but like 更新 it evaluates improvement rather
// than crediting an existing page as newly-created content.
export function isIncrementalOperation(operation: string | null | undefined) {
  return operation === '更新' || operation === '覆盖'
}

export function submissionOperationPriority(operation: string | null | undefined) {
  return operation === '覆盖' ? 2 : operation === '更新' ? 1 : 0
}
