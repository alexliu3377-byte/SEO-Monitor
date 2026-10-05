import { redirect } from 'next/navigation'
import { KeywordClassificationClient } from './keyword-classification-client'
import { getUserProfile } from '@/lib/get-user-profile'

export default async function KeywordClassificationPage() {
  const profile = await getUserProfile()
  if (!profile) redirect('/login')
  return <KeywordClassificationClient canDelete={profile.role === 'super'} />
}
