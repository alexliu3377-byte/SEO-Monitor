// Supabase/PostgREST 在这个项目上会把单次查询硬截到 3000 行，不管 .limit()/.range()
// 传多大——这个上限是服务端强制的，客户端请求不到就是拿不到，之前"先count再limit"
// 的写法治标不治本（超过3000还是会被截断，只是从默认更小的截断值变成3000）。
// 真正的修复是分页：用 .range() 把行拉全。
//
// 给了 countHint（另外查一次精确 count）时并行拉所有页——数据量大的场景（比如
// 月度趋势是全站点整月的 rank_changes，一个月能有80万行）顺序一页页翻会话
// 要翻两三百次，串行等下来单次请求就能拖到几分钟，在 serverless 函数超时
// 前根本跑不完。没给 countHint 时退化成顺序翻页（单站点研究任务这种量级
// 小的场景，省一次额外的 count 查询）。
export async function fetchAllRows<T>(
  buildQuery: (from: number, to: number) => Promise<{ data: T[] | null; error: { message: string } | null }>,
  opts: { pageSize?: number; countHint?: number } = {}
): Promise<T[]> {
  const pageSize = opts.pageSize ?? 3000

  if (opts.countHint != null) {
    // 全部页一次性 Promise.all 会在页数很多时（80万行/3000一页=270+页）打爆
    // 连接池（实测报 "Timed out acquiring connection from connection pool"），
    // 分批并发（每批15页）既比串行快得多，也不会把连接池打满。
    const CONCURRENCY = 15
    const pages = Math.max(1, Math.ceil(opts.countHint / pageSize))
    const out: T[] = []
    for (let batchStart = 0; batchStart < pages; batchStart += CONCURRENCY) {
      const batch = Array.from(
        { length: Math.min(CONCURRENCY, pages - batchStart) },
        (_, j) => { const i = batchStart + j; return buildQuery(i * pageSize, i * pageSize + pageSize - 1) }
      )
      const results = await Promise.all(batch)
      for (const { data, error } of results) {
        if (error) throw new Error(error.message)
        if (data) out.push(...data)
      }
    }
    return out
  }

  const out: T[] = []
  let from = 0
  for (;;) {
    const { data, error } = await buildQuery(from, from + pageSize - 1)
    if (error) throw new Error(error.message)
    if (!data || data.length === 0) break
    out.push(...data)
    if (data.length < pageSize) break
    from += pageSize
  }
  return out
}
