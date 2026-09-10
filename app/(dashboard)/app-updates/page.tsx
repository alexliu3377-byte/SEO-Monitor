import { redirect } from 'next/navigation'
import { getUserProfile } from '@/lib/get-user-profile'
import AppUpdateCenterClient from './app-update-center-client'

export default async function AppUpdateCenterPage() {
  const profile = await getUserProfile()
  if (!profile) redirect('/login')
  if (profile.role !== 'super') redirect('/')
  return <AppUpdateCenterClient />
}
