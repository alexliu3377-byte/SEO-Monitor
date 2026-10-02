import { redirect } from 'next/navigation'
import { getUserProfile } from '@/lib/get-user-profile'
import AppUpdateCenterClient from './app-update-center-client'

export default async function AppUpdateCenterPage() {
  const profile = await getUserProfile()
  if (!profile) redirect('/login')
  return <AppUpdateCenterClient canManage={profile.role !== 'normal'} />
}
