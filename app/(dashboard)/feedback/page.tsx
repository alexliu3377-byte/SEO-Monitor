import { redirect } from 'next/navigation'
import FeedbackClient from './feedback-client'
import { getUserProfile } from '@/lib/get-user-profile'

export default async function FeedbackPage() {
  const profile = await getUserProfile()
  if (!profile) redirect('/login')
  return <FeedbackClient initialRole={profile.role} />
}
