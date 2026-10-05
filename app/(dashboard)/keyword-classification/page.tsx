import { redirect } from 'next/navigation'
import { KeywordClassificationClient } from './keyword-classification-client'
import { getUserProfile } from '@/lib/get-user-profile'
import { isProjectOwner } from '@/lib/project-owner'

export default async function KeywordClassificationPage() {
  const profile = await getUserProfile()
  if (!profile) redirect('/login')
  if (!isProjectOwner(profile.id)) redirect('/hot-keywords')
  return <KeywordClassificationClient canDelete={profile.role === 'super'} />
}
