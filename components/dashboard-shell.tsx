'use client'

import { usePathname } from 'next/navigation'
import Sidebar from './sidebar'

export default function DashboardShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()

  if (pathname === '/') {
    return <main id="main-content" className="min-h-screen bg-slate-50">{children}</main>
  }

  return (
    <div className="flex h-dvh overflow-hidden">
      <Sidebar />
      <main id="main-content" className="min-h-0 min-w-0 flex-1 overflow-y-auto bg-slate-50 pt-14 lg:ml-[220px] lg:pt-0">
        {children}
      </main>
    </div>
  )
}
