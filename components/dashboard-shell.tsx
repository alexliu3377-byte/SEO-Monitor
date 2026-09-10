'use client'

import { usePathname } from 'next/navigation'
import Sidebar from './sidebar'

export default function DashboardShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()

  if (pathname === '/') {
    return <main id="main-content" className="min-h-screen bg-slate-950">{children}</main>
  }

  return (
    <div className="flex min-h-screen lg:h-screen lg:overflow-hidden">
      <Sidebar />
      <main id="main-content" className="min-h-screen flex-1 bg-slate-50 pt-14 lg:ml-[220px] lg:h-screen lg:overflow-y-auto lg:pt-0">
        {children}
      </main>
    </div>
  )
}
