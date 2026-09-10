import DashboardShell from '@/components/dashboard-shell'
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
      <DashboardShell>{children}</DashboardShell>
    </UserProvider>
  )
}
