import { redirect } from 'next/navigation'
import { getUserProfile } from '@/lib/get-user-profile'
import { isProjectOwner } from '@/lib/project-owner'

export default async function PageStudioLayout({ children }: { children: React.ReactNode }) {
  const profile = await getUserProfile()
  if (!profile) redirect('/login')
  if (profile.role !== 'super' || !isProjectOwner(profile.id)) redirect('/')
  return children
}
