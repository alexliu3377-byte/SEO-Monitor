// 「导出词和链接」的文件格式（2026-11-20）：浏览器里用，不引用任何服务端模块。
// 列：词、游戏/应用、分类、链接数、网站链接（最多 5 个，「，」隔开）、标题（和链接一一对应，「｜」隔开）。
// 没有链接的词链接数写 0、链接留空。搜索量只用来筛，不导出。
export type ExportRow = { keyword: string; category: '游戏' | '应用'; subcategory: string | null; pageCount: number; pages: { url: string; title: string }[] }

const cell = (value: unknown) => {
  const text = String(value ?? '').replace(/\r?\n/g, ' ')
  // 以 = + - @ 开头的格子前面加 '，防止 Excel 把它当公式执行。
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text
  return `"${safe.replace(/"/g, '""')}"`
}

// Excel 能直接打开的 CSV（UTF-8 带 BOM，中文不乱码）。
export function buildExportCsv(rows: ExportRow[]): string {
  const lines = [['词', '游戏/应用', '分类', '链接数', '网站链接', '标题'].map(cell).join(',')]
  for (const row of rows) {
    lines.push([row.keyword, row.category, row.subcategory ?? '', row.pageCount, row.pages.map(p => p.url).join('，'), row.pages.map(p => p.title).join('｜')].map(cell).join(','))
  }
  return '﻿' + lines.join('\r\n') + '\r\n'
}
