export function radarDate(offset = 0, now = Date.now()) {
  return new Date(now + 8 * 3600000 + offset * 86400000).toISOString().slice(0, 10)
}
export function radarDates(now = Date.now()) {
  return Array.from({ length: 7 }, (_, index) => radarDate(-index, now))
}
export function radarUsesYesterday(tab: string) {
  return ['cross', 'newWords', 'new', 'wordLib'].includes(tab)
}
export function radarDateOptions(now = Date.now(), tab = '') {
  return [{ value: 'all', label: radarUsesYesterday(tab) ? '昨日（全部）' : '今日（全部）' },
    ...radarDates(now).slice(1).map(date => ({ value: date, label: date }))]
}
export function validRadarDate(value: string, now = Date.now()) { return radarDates(now).includes(value) }
// "all" reads retained dates; content-publication tabs exclude today in SQL.
// It is never a cache-build date.
export function validRadarDateSelection(value: string, now = Date.now()) {
  return value === 'all' || validRadarDate(value, now)
}
