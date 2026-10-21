// Bounded, body-free availability metadata for the current content-feed page.
// A blocked/unfinished video may still have readable article text.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function loadContentTranscriptMetadata(service: any, itemIds: string[]) {
  const states = new Map<string, string>()
  const textIds = new Set<string>()
  if (!itemIds.length) return { states, textIds, unavailable: false }
  const [statuses, text] = await Promise.all([
    service.from('content_feed_transcripts').select('item_id,status').in('item_id', itemIds),
    service.from('content_feed_transcripts').select('item_id').in('item_id', itemIds)
      .or('transcript_text.neq."",article_text.neq.""'),
  ])
  const unavailable = Boolean(statuses.error || text.error)
  if (!unavailable) {
    for (const row of statuses.data ?? []) states.set(row.item_id, row.status)
    for (const row of text.data ?? []) textIds.add(row.item_id)
  }
  return { states, textIds, unavailable }
}
