import DashboardShell from '@/components/dashboard-shell'
import DailyLoginGuard from '@/components/daily-login-guard'
import UserProvider from '@/components/user-provider'
import { getUserProfile } from '@/lib/get-user-profile'

function kualaLumpurDate(value = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kuala_Lumpur',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value)
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const profile = await getUserProfile()
  return (
    <UserProvider profile={profile}>
      <DailyLoginGuard
        enabled={profile?.role === 'normal' || profile?.role === 'admin'}
        renderedDate={kualaLumpurDate()}
      />
      <DashboardShell>{children}</DashboardShell>
    </UserProvider>
  )
}
