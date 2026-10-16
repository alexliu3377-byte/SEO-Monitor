import { formatVolumeRiseDate } from '@/lib/keyword-volume-date'

export function VolumeRiseDateCell({ date, today, yesterday, className = 'table-td' }: {
  date: string; today: string; yesterday: string; className?: string
}) {
  const label = formatVolumeRiseDate(date)
  const recorded = label !== '未记录'
  return (
    <td className={`${className} whitespace-nowrap text-xs ${date === today || date === yesterday ? 'text-green-600' : 'text-gray-400'}`}
      title={recorded ? '当天实际发现搜索量上涨；重新采集但数值不变不会更新日期' : '历史上涨发现日期未记录，不能用采集日期代替'}>
      {recorded ? <time dateTime={date}>{label}</time> : <span>{label}</span>}
    </td>
  )
}
