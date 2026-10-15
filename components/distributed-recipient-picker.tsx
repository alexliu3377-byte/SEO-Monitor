'use client'

import { useId } from 'react'

export default function DistributedRecipientPicker({ members, value, onChange, disabled = false }: {
  members: readonly { user_id: string; username: string }[]
  value: string[] | null
  onChange: (value: string[] | null) => void
  disabled?: boolean
}) {
  const id = useId()
  return <fieldset disabled={disabled} className="min-w-0 space-y-2">
    <legend className="mb-1 text-xs font-medium text-gray-700">领取对象</legend>
    <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-gray-700">
      <label className="inline-flex cursor-pointer items-center gap-2 py-1">
        <input type="radio" name={`${id}-scope`} checked={value === null} onChange={() => onChange(null)} className="accent-green-600" />全组
      </label>
      <label className="inline-flex cursor-pointer items-center gap-2 py-1">
        <input type="radio" name={`${id}-scope`} checked={value !== null} onChange={() => onChange([])} className="accent-green-600" />指定组员
      </label>
    </div>
    {value !== null && <>
      {members.length === 0 ? <p className="text-xs text-amber-700">当前分组没有组员，请先在分组管理中添加。</p>
        : <div className="grid max-h-44 grid-cols-1 gap-1 overflow-y-auto rounded-lg border border-gray-200 p-2 sm:grid-cols-2">
          {members.map(member => <label key={member.user_id} className="flex min-w-0 cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm text-gray-700 hover:bg-gray-50">
            <input type="checkbox" checked={value.includes(member.user_id)} className="shrink-0 accent-green-600"
              onChange={event => onChange(event.target.checked ? [...value, member.user_id] : value.filter(userId => userId !== member.user_id))} />
            <span className="truncate" title={member.username}>{member.username}</span>
          </label>)}
        </div>}
      <p className={`text-xs leading-5 ${value.length ? 'text-gray-500' : 'text-amber-700'}`} role="status">
        {value.length ? `已选 ${value.length} 人；只有所选组员能看到并认领，管理员仍可查看全部。` : '请至少选择一名组员。'}
      </p>
      <p className="text-xs leading-5 text-gray-500">指定多人时共享这批词，不会给每人复制一份；认领与冷却规则不变。</p>
    </>}
  </fieldset>
}
