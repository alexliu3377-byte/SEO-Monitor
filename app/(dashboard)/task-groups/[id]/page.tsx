import TaskGroupsPage from '../page'

export default async function TaskGroupWorkspaceRoute({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  return <TaskGroupsPage groupId={id} />
}
