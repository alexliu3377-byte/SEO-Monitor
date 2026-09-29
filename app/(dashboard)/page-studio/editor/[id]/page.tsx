import 'grapesjs/dist/css/grapes.min.css'
import PageStudioEditor from '@/components/page-studio-editor'

export default async function PageStudioEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <PageStudioEditor projectId={id} />
}
