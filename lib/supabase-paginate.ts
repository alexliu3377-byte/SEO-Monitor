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
//
// ⚠️ 调用方的 buildQuery 必须在 .range() 之前加一个能唯一确定顺序的 .order()
// （比如按主键 id 排序），不能不排序就直接 .range()——2026-08-06 实测：同一个
// 查询不排序、连续 range(0,2999) 调两次，返回的3000行里有2457行是不一样的。
// Postgres 在没有 ORDER BY 时不保证跨请求顺序稳定，range() 分页翻页翻到一半
// 换了行序，会导致有些行两页都拿到（重复），有些行两页都漏掉（丢失）——而且
// 不会报错，算出来的聚合结果会悄悄错（这次就是这样测出一个关键词的 volume
// 算错了才发现）。只按业务需要排的列（比如 stat_date）如果有重复值，同样
// 不够，还要再加一层按 id 排序兜底去重复。
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
