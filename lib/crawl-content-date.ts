const DAY = 86_400_000
const mytDate = (time: number) => new Date(time + 8 * 3_600_000).toISOString().slice(0, 10)

function calendarDate(year: number, month: number, day: number): string | null {
  const value = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  const date = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === value ? value : null
}

// Unknown source dates stay unknown. Discovery time is not publication time.
export function parseCrawlContentDate(raw: string | undefined, now = Date.now()): string | null {
  const value = raw?.trim()
  if (!value) return null
  const absolute = value.match(/(\d{4})[年/\-](\d{1,2})[月/\-](\d{1,2})/)
  if (absolute) return calendarDate(Number(absolute[1]), Number(absolute[2]), Number(absolute[3]))
  const shortYear = value.match(/^(\d{2})[/\-](\d{1,2})[/\-](\d{1,2})/)
  if (shortYear) return calendarDate(2000 + Number(shortYear[1]), Number(shortYear[2]), Number(shortYear[3]))
  const relative = value.match(/^(\d+)(分钟|小时|天)前(?:发布|更新)?$/)
  if (relative) {
    const elapsed = Number(relative[1]) * ({ 分钟: 60_000, 小时: 3_600_000, 天: DAY }[relative[2]]!)
    return Number.isFinite(elapsed) && elapsed <= 366 * DAY ? mytDate(now - elapsed) : null
  }
  if (/^(刚刚|今天)(?:发布|更新)?$/.test(value)) return mytDate(now)
  if (/^(昨天|一天前)(?:发布|更新)?$/.test(value)) return mytDate(now - DAY)
  const monthDay = value.match(/(\d{1,2})[/\-](\d{1,2})/)
  if (monthDay) {
    const today = mytDate(now), year = Number(today.slice(0, 4))
    const candidate = calendarDate(year, Number(monthDay[1]), Number(monthDay[2]))
    if (!candidate) return null
    return candidate <= today ? candidate : calendarDate(year - 1, Number(monthDay[1]), Number(monthDay[2]))
  }
  return null
}
