import { radarDate, validRadarDateSelection } from './radar-dates'

export function radarTabDate(tab: string, selected?: string, now = Date.now()) {
  if (selected === radarDate(0,now)) return 'all'
  if (selected && validRadarDateSelection(selected,now)) return selected
  return 'all'
}
export function radarTabScope(tab: string, groupId = 'global') { return `${groupId}|${tab}` }
