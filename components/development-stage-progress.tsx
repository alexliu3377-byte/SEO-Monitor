import { DEVELOPMENT_FLOW, STAGE_LABELS, type DevelopmentStage } from '@/lib/development-progress'

// Stage position is not a percentage of work completed. Checklist completion
// remains separate, so a fully checked task cannot imply deployment.
export function DevelopmentStageProgress({ stage }: { stage: DevelopmentStage }) {
  const current = DEVELOPMENT_FLOW.indexOf(stage)
  const position = current < 0 ? 0 : current / (DEVELOPMENT_FLOW.length - 1) * 100
  return <div role="group" aria-label={`开发阶段，当前${STAGE_LABELS[stage]}`} className="relative pt-2" data-development-stepper={stage}>
    <div aria-hidden="true" className="absolute left-[8.333333%] right-[8.333333%] top-[16px] h-1 rounded-full bg-slate-200">
      <div className="h-full rounded-full bg-emerald-600" style={{ width: `${position}%` }} />
    </div>
    <ol className="relative grid grid-cols-6">
      {DEVELOPMENT_FLOW.map((value, index) => <li key={value} aria-current={index === current ? 'step' : undefined} className="flex min-w-0 flex-col items-center gap-3 text-center">
        <span aria-hidden="true" className={`h-5 w-5 rounded-full border-2 ${index <= current ? 'border-emerald-600 bg-emerald-600' : 'border-slate-300 bg-slate-300'} ${index === current ? 'ring-4 ring-emerald-100' : ''}`} />
        <span className={`text-xs leading-5 ${index === current ? 'font-semibold text-emerald-800' : index < current ? 'text-emerald-700' : 'text-slate-600'}`}>{STAGE_LABELS[value]}</span>
        <span className="sr-only">{index === current ? '当前阶段' : index < current ? '已到达' : '尚未到达'}</span>
      </li>)}
    </ol>
    {current < 0 && <p className="mt-2 text-center text-xs text-amber-800">{STAGE_LABELS[stage]}：不推定已完成的开发阶段，具体进展请看历史记录。</p>}
  </div>
}
