import { radarDate, validRadarDate } from './radar-dates'

export function radarTabDate(tab: string, selected?: string, now = Date.now()) {
  return selected && validRadarDate(selected, now) ? selected : radarDate(tab === 'newWords' || tab === 'new' || tab === 'wordLib' ? -1 : 0, now)
}
export function radarTabScope(tab: string, groupId = 'global') { return `${groupId}|${tab}` }
