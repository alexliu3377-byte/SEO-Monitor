import { redirect } from 'next/navigation'
import { getUserProfile } from '@/lib/get-user-profile'
import SystemMapClient from './system-map-client'

export default async function SystemMapPage() {
  const profile = await getUserProfile()
  if (!profile) redirect('/login')
  if (profile.role !== 'super') redirect('/')
  return <SystemMapClient />
}
