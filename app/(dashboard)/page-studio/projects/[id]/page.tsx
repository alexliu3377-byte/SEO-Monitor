import PageStudioProjectDetail from '@/components/page-studio-project-detail'

export default async function PageStudioProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <PageStudioProjectDetail projectId={id} />
}
