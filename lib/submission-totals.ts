export interface SubmissionRow { group_id: string; user_id: string; source: string; search_volume: number }
export interface SubmissionTotal extends SubmissionRow { count: number }

// Keep grouped totals rather than every submission; pages still use a unique order.
export async function loadSubmissionTotals(read: (from: number, to: number) => PromiseLike<{
  data: SubmissionRow[] | null; error: { message: string } | null
}>, pageSize = 3000): Promise<SubmissionTotal[]> {
  const totals = new Map<string, SubmissionTotal>()
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await read(from, from + pageSize - 1)
    if (error) throw new Error(error.message)
    for (const row of data ?? []) {
      const key = JSON.stringify([row.group_id, row.user_id, row.source])
      const total = totals.get(key) ?? { ...row, search_volume: 0, count: 0 }
      total.count++
      total.search_volume += Number(row.search_volume) || 0
      totals.set(key, total)
    }
    if (!data || data.length < pageSize) break
  }
  return [...totals.values()]
}
