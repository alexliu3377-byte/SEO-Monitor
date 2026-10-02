import { redirect } from 'next/navigation'
import { KeywordClassificationClient } from './keyword-classification-client'
import { isProjectOwner } from '@/lib/project-owner'
import { createClient } from '@/lib/supabase-server'

export default async function KeywordClassificationPage() {
  const auth = await createClient()
  const { data: { user } } = await auth.auth.getUser()
  if (!user) redirect('/login')
  if (!isProjectOwner(user.id)) redirect('/hot-keywords')
  return <KeywordClassificationClient />
}
