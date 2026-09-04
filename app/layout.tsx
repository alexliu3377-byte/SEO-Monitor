import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: '奇心内容发布系统',
  description: '内容发布、SEO监控与竞品分析系统',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  )
}
