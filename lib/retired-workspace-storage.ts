type WorkspaceStorage = Pick<Storage, 'length' | 'key' | 'removeItem'>

const RETIRED_KEYS = new Set([
  'qixin-page-studio-projects-v1',
  'qixin-page-studio-favorite-modules-v1',
  'page-studio-deleted-projects',
])

// Never clear all storage: authentication and active business caches share it.
export function clearRetiredWorkspaceStorage(storage: WorkspaceStorage): void {
  try {
    for (let index = storage.length - 1; index >= 0; index--) {
      const key = storage.key(index)
      if (key && (RETIRED_KEYS.has(key) || key.startsWith('page-studio-project:'))) {
        storage.removeItem(key)
      }
    }
  } catch {
    // Storage can be disabled or inaccessible. Retirement must not block login.
  }
}
