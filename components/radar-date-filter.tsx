'use client'

type DateFilterProps = {
  value: string
  onChange: (value: string) => void
} & (
  | { kind?: 'select'; options: { value: string; label: string }[] }
  | { kind: 'calendar'; min: string; max: string }
)

// Match the compact filter row; native controls retain keyboard and calendar support.
const controlClass = 'h-8 w-36 rounded border border-gray-200 bg-white px-2 py-1 text-sm text-gray-700 focus:outline-none focus:ring-1 focus:ring-green-400 cursor-pointer'

export function RadarDateFilter(props: DateFilterProps) {
  return (
    <label className="flex items-center gap-1.5 text-xs text-gray-400">
      <span className="whitespace-nowrap">资料日期</span>
      {props.kind === 'calendar' ? (
        <input aria-label="选择资料日期" type="date" value={props.value} min={props.min} max={props.max}
          onChange={event => {
            const value = event.target.value
            if (value && value >= props.min && value <= props.max) props.onChange(value)
          }}
          className={controlClass} />
      ) : (
        <select aria-label="筛选资料日期" value={props.value} onChange={event => props.onChange(event.target.value)}
          className={controlClass}>
          {props.options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      )}
    </label>
  )
}
