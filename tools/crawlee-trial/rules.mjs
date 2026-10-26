export const SOURCES = Object.freeze([
  Object.freeze({ domain: 'niucoo.cn', url: 'https://www.niucoo.cn/game/', titleSelector: '.imgInfo p:first-of-type', dateSelector: '.tip:last-of-type' }),
  Object.freeze({ domain: '18touch.com', url: 'https://www.18touch.com/game/', titleSelector: '.chwAppList a.name', dateSelector: 'div em' }),
])
const DAY = 86400000
export const mytDate = (time = Date.now()) => new Date(Number(time) + 8 * 3600000).toISOString().slice(0, 10)

function validDate(year, month, day) {
  const value = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  const date = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === value ? value : null
}

// The baseline mirrors the current parser's relevant date semantics, including
// its minutes/hours-before-midnight bug. It never fills unknown dates with yesterday.
export function baselineDate(raw, now) {
  const value = raw.trim()
  const absolute = value.match(/(\d{4})[/-](\d{1,2})[/-](\d{1,2})/)
  if (absolute) return `${absolute[1]}-${absolute[2].padStart(2, '0')}-${absolute[3].padStart(2, '0')}`
  if (/^\d+(?:分钟|小时)前$/.test(value)) return mytDate(now)
  if (value === '昨天' || value === '一天前') return mytDate(now - DAY)
  const days = value.match(/^(\d+)天前$/)
  return days ? mytDate(now - Number(days[1]) * DAY) : null
}

// Trial business rules, NOT automatic corrections provided by Crawlee.
export function trialDate(raw, now) {
  const value = raw.trim()
  const absolute = value.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?(?:发布|更新)?$/)
  if (absolute) return validDate(Number(absolute[1]), Number(absolute[2]), Number(absolute[3]))
  const relative = value.match(/^(\d+)(分钟|小时|天)前(?:发布|更新)?$/)
  if (relative) {
    const duration = Number(relative[1]) * ({ 分钟: 60000, 小时: 3600000, 天: DAY }[relative[2]])
    return Number.isFinite(duration) && duration <= 366 * DAY ? mytDate(now - duration) : null
  }
  if (/^(刚刚|今天)(?:发布|更新)?$/.test(value)) return mytDate(now)
  if (/^(昨天|一天前)(?:发布|更新)?$/.test(value)) return mytDate(now - DAY)
  return null
}

export function isDetailUrl(value, source) {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password && !url.port &&
      [source.domain, `www.${source.domain}`].includes(url.hostname) &&
      /^\/(?:game|soft)\/\d+\.html$/.test(url.pathname)
  } catch { return false }
}

function findInContainer(dom, el, selector) {
  let container = dom(el).closest('li,article,.item,tr,p,dd')
  if (!container.length) container = dom(el).closest('div').parent()
  const within = candidate => {
    const node = candidate.get(0)
    return dom(selector).filter((_, match) => match === node || dom.contains(node, match))
  }
  let found = within(container)
  if (!found.length && container.length) {
    const wider = container.parent().closest('li,article,.item,tr,p,dd')
    if (wider.length && wider.get(0) !== container.get(0)) found = within(wider)
  }
  return found
}

export function comparePage(dom, source, now) {
  const rows = dom(source.titleSelector).slice(0, 250).map((_, el) => {
    const title = dom(el).text().trim().slice(0, 180)
    const href = dom(el).attr('href') || dom(el).closest('a').attr('href') || ''
    let url = ''
    try { url = new URL(href, source.url).href } catch { /* Invalid links remain invalid. */ }
    const rawDate = findInContainer(dom, el, source.dateSelector).first().text().trim().slice(0, 100)
    return { title, url, raw_date: rawDate, baseline_date: baselineDate(rawDate, now), trial_date: trialDate(rawDate, now) }
  }).get().filter(row => row.title)
  const detailRows = rows.filter(row => isDetailUrl(row.url, source))
  const yesterday = mytDate(now - DAY)
  const unknown = detailRows.filter(row => !row.trial_date).length
  const future = detailRows.filter(row => row.trial_date > mytDate(now)).length
  const issues = []
  if (!detailRows.length) issues.push('没有有效详情条目；不能解释为昨日没有发布')
  if (unknown) issues.push(`${unknown} 条详情日期无法识别（不填充为昨日）`)
  if (future) issues.push(`${future} 条详情日期在未来`)
  if (dom(source.titleSelector).length > 250) issues.push('条目超过试验上限 250，结果被截断')
  return {
    baseline: { candidates: rows.length, unknown_dates: rows.filter(row => !row.baseline_date).length, yesterday: rows.filter(row => row.baseline_date === yesterday).length },
    trial: { candidates: detailRows.length, excluded_noncontent_links: rows.length - detailRows.length, unknown_dates: unknown, future_dates: future, yesterday: detailRows.filter(row => row.trial_date === yesterday).length, today: detailRows.filter(row => row.trial_date === mytDate(now)).length },
    // Small samples only; no page snapshots, credentials or full content archives.
    sample: detailRows.slice(0, 3), issues,
  }
}
