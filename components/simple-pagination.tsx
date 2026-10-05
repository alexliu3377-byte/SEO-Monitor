const PAGE_SIZE = 20

export function SimplePagination({ page, total, onChange, pageSize = PAGE_SIZE, disabled = false }: {
  page: number
  total: number
  onChange: (p: number) => void
  pageSize?: number
  disabled?: boolean
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  if (totalPages <= 1 && total <= pageSize) return null
  return (
    <div className="flex items-center justify-between px-5 py-3 border-t border-gray-100 text-xs text-gray-500">
      <span>共 {total} 个，每页 {pageSize} 个</span>
      <div className="flex items-center gap-1">
        <button aria-label="第一页" disabled={disabled || page === 0} onClick={() => onChange(0)} className="px-1.5 py-1 rounded border border-gray-200 disabled:opacity-30 hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500">«</button>
        <button aria-label="上一页" disabled={disabled || page === 0} onClick={() => onChange(page - 1)} className="px-1.5 py-1 rounded border border-gray-200 disabled:opacity-30 hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500">‹</button>
        <span className="px-2 text-gray-600">{page + 1} / {totalPages}</span>
        <button aria-label="下一页" disabled={disabled || page >= totalPages - 1} onClick={() => onChange(page + 1)} className="px-1.5 py-1 rounded border border-gray-200 disabled:opacity-30 hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500">›</button>
        <button aria-label="最后一页" disabled={disabled || page >= totalPages - 1} onClick={() => onChange(totalPages - 1)} className="px-1.5 py-1 rounded border border-gray-200 disabled:opacity-30 hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500">»</button>
      </div>
    </div>
  )
}

export { PAGE_SIZE }
