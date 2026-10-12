import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { getUserProfile } from '@/lib/get-user-profile'
import ChartsClient from './charts-client'

function PageLoading() {
  return (
    <div className="p-5 sm:p-8" role="status" aria-label="正在打开内容发现">
      <div className="h-8 w-32 animate-pulse rounded bg-slate-200 motion-reduce:animate-none" />
      <div className="mt-5 h-11 animate-pulse rounded-lg bg-slate-100 motion-reduce:animate-none" />
      <div className="mt-5 h-72 animate-pulse rounded-2xl bg-slate-100 motion-reduce:animate-none" />
    </div>
  )
}

export default async function ChartsPage() {
  const profile = await getUserProfile()
  if (!profile) redirect('/login')

  return (
    <Suspense fallback={<PageLoading />}>
      <ChartsClient />
    </Suspense>
  )
}
