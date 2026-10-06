export interface AizhanDailyData {
  pc: number
  mobile: number
  indexCount: number
  pcIpMin: number
  pcIpMax: number
  mobileIpMin: number
  mobileIpMax: number
  weightValid: boolean
  indexValid: boolean
}

export async function persistAizhanDaily(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  siteId: string,
  recordDate: string,
  data: AizhanDailyData,
) {
  const { data: decisions, error: decisionError } = await supabase.rpc('record_aizhan_daily_observation', {
    p_site_id: siteId,
    p_record_date: recordDate,
    p_weight_valid: data.weightValid,
    p_pc_weight: data.pc,
    p_mobile_weight: data.mobile,
    p_index_valid: data.indexValid,
    p_index_count: data.indexCount,
  })
  if (decisionError) throw decisionError

  const decision = Array.isArray(decisions) ? decisions[0] : decisions
  const weightStored = decision?.weight_should_store === true
  const indexStored = decision?.index_should_store === true
  const writes: PromiseLike<{ error: { message: string } | null }>[] = []

  if (weightStored) {
    writes.push(supabase.from('weight_history').upsert(
      {
        site_id: siteId,
        record_date: recordDate,
        pc_weight: data.pc,
        mobile_weight: data.mobile,
        pc_ip: data.pcIpMin,
        pc_ip_max: data.pcIpMax,
        mobile_ip: data.mobileIpMin,
        mobile_ip_max: data.mobileIpMax,
      },
      { onConflict: 'site_id,record_date' },
    ))
  }
  if (indexStored) {
    writes.push(supabase.from('index_snapshots').upsert(
      { site_id: siteId, snapshot_date: recordDate, index_count: data.indexCount },
      { onConflict: 'site_id,snapshot_date' },
    ))
  }

  const results = await Promise.all(writes)
  const writeError = results.find(result => result.error)?.error
  if (writeError) throw new Error(writeError.message)

  return {
    rowsWritten: Number(weightStored) + Number(indexStored),
    weightStored,
    indexStored,
    pendingZero: (data.weightValid && (data.pc === 0 || data.mobile === 0) && !weightStored)
      || (data.indexValid && data.indexCount === 0 && !indexStored),
  }
}
