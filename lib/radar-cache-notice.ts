export interface RadarCacheMetadata {
  stale?: boolean
  failedSections?: readonly string[]
  sourceComplete?: boolean
  sourceWarnings?: readonly { reason: string }[]
}

export interface RadarCacheNotice {
  tone: 'info' | 'warning'
  message: string
}

// Browser-safe presentation shared by the group workspace and global radar.
// Missing legacy/source-status metadata never implies a collection is running.
export function radarCacheNotice(meta: RadarCacheMetadata | null | undefined, sections?: readonly string[]): RadarCacheNotice | null {
  if (!meta) return null
  if (meta.stale || meta.failedSections?.some(section => !sections || sections.includes(section))) {
    return { tone: 'warning', message: '部分资料暂未完成刷新，当前保留上次成功保存的结果。' }
  }
  if (meta.sourceWarnings?.some(warning => warning.reason === 'partial')) {
    return { tone: 'warning', message: '部分来源未取得完整资料，当前显示已取得的资料。' }
  }
  if (meta.sourceWarnings?.some(warning => warning.reason === 'unfinished')) {
    return { tone: 'warning', message: '本批采集尚未完成，当前显示已有资料。' }
  }
  if (meta.sourceComplete === false || meta.sourceWarnings?.length) {
    return { tone: 'info', message: '采集状态待确认，当前显示已有资料。' }
  }
  return null
}
