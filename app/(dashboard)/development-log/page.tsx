import { redirect } from 'next/navigation'
import DevelopmentLogClient from './development-log-client'
import { getUserProfile } from '@/lib/get-user-profile'
import { canReadDevelopmentLog } from '@/lib/development-log'

export default async function DevelopmentLogPage() {
  const profile = await getUserProfile()
  if (!profile) redirect('/login')
  if (!canReadDevelopmentLog(profile.role)) redirect('/')
  return <DevelopmentLogClient />
}
