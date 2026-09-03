import Sidebar from '@/components/sidebar'
import UserProvider from '@/components/user-provider'
import { getUserProfile } from '@/lib/get-user-profile'

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const profile = await getUserProfile()
  return (
    <UserProvider profile={profile}>
      <div className="flex min-h-screen lg:h-screen lg:overflow-hidden">
        <Sidebar />
        <main id="main-content" className="flex-1 bg-slate-50 min-h-screen pt-14 lg:pt-0 lg:ml-[220px] lg:h-screen lg:overflow-y-auto">
          {children}
        </main>
      </div>
    </UserProvider>
  )
}
