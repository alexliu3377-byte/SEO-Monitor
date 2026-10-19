export function radarDate(offset = 0, now = Date.now()) {
  return new Date(now + 8 * 3600000 + offset * 86400000).toISOString().slice(0, 10)
}
export function radarDates(now = Date.now()) {
  return Array.from({ length: 7 }, (_, index) => radarDate(-index, now))
}
export function validRadarDate(value: string, now = Date.now()) { return radarDates(now).includes(value) }
