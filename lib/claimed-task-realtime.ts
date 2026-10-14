interface VisibleClaim { id: string; status: string; claimed_date?: string }

// Ownership transfers are UPDATE events, not new INSERTs. Remove the former
// owner's row and add/update the new owner's row with all changed fields.
export function applyClaimRealtimeEvent<T extends VisibleClaim>(
  rows: T[], event: 'INSERT' | 'UPDATE' | 'DELETE',
  record: T & { user_id?: string }, viewingUserId: string, today: string,
): T[] {
  if (!record?.id) return rows
  if (event === 'DELETE') return rows.filter(row => row.id !== record.id)
  const visible = record.user_id === viewingUserId && record.status !== 'dismissed'
    && (record.claimed_date === today || (record.status === 'pending' && !!record.claimed_date && record.claimed_date < today))
  if (!visible) return rows.filter(row => row.id !== record.id)
  return rows.some(row => row.id === record.id)
    ? rows.map(row => row.id === record.id ? { ...row, ...record } : row)
    : [...rows, record]
}
