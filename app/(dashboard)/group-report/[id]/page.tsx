import GroupReportPage from '../page'

export default async function GroupReportRoute({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ view?: string }>
}) {
  const [{ id }, query] = await Promise.all([params, searchParams])
  const initialTab = query.view === 'summary' ? 'trackingSummary' : 'outcomes'

  return <GroupReportPage groupId={id} initialTab={initialTab} />
}
