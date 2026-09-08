import { redirect } from 'next/navigation'
import { getUserProfile } from '@/lib/get-user-profile'
import TrendDiscoveryClient from './trend-discovery-client'

export default async function TrendDiscoveryPage() {
  const profile = await getUserProfile()
  if (!profile) redirect('/login')
  return <TrendDiscoveryClient initialRole={profile.role} />
}
