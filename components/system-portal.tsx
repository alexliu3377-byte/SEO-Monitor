'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { getBrowserClient } from '@/lib/supabase'
import { useUser } from '@/lib/user-context'

function ArrowIcon() {
  return <svg aria-hidden="true" viewBox="0 0 20 20" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8"><path strokeLinecap="round" strokeLinejoin="round" d="M4 10h12m-4-4 4 4-4 4" /></svg>
}

export default function SystemPortal() {
  const router = useRouter()
  const { email, role } = useUser()

  async function logout() {
    await getBrowserClient().auth.signOut()
    router.push('/login')
    router.refresh()
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex h-20 max-w-6xl items-center justify-between gap-4 px-5 sm:px-8">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-600 text-base font-black text-white">奇</div>
            <div>
              <p className="font-semibold tracking-wide text-slate-900">奇心工作台</p>
              <p className="mt-0.5 text-xs text-slate-500">后台系统入口</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden max-w-56 truncate text-xs text-slate-500 sm:block">{email}</span>
            <button type="button" onClick={logout} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900">退出登录</button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-5 py-12 sm:px-8 sm:py-16">
        <section className="max-w-3xl">
          <p className="text-sm font-semibold text-emerald-700">工作系统</p>
          <h1 className="mt-3 text-3xl font-bold tracking-tight text-slate-950 sm:text-4xl">选择要进入的后台</h1>
          <p className="mt-4 text-base leading-7 text-slate-600">各系统共用当前登录账号，但工作内容、导航和功能范围相互独立。</p>
        </section>

        <section className="mt-10 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-5 py-4 sm:px-7">
            <h2 className="text-sm font-semibold text-slate-900">后台列表</h2>
            <p className="mt-1 text-xs text-slate-500">只显示当前账号可以访问的系统</p>
          </div>

          <div className="divide-y divide-slate-100">
            <Link href="/content" className="group flex items-center gap-4 px-5 py-6 transition hover:bg-emerald-50/40 sm:gap-5 sm:px-7">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700">
                <svg aria-hidden="true" viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.8"><path strokeLinecap="round" strokeLinejoin="round" d="M4 19V9m5 10V5m5 14v-7m5 7V3" /></svg>
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2.5">
                  <h3 className="text-lg font-semibold text-slate-950">内容发布系统</h3>
                  <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-700">正式使用</span>
                </div>
                <p className="mt-1.5 text-sm leading-6 text-slate-600">站点监控、任务协作、成效报告、研究中心与日常内容运营。</p>
                <p className="mt-2 text-xs text-slate-400">/content</p>
              </div>
              <span className="shrink-0 text-emerald-600 transition-transform group-hover:translate-x-1"><ArrowIcon /></span>
            </Link>

            {role === 'super' && (
              <Link href="/app-updates" className="group flex items-center gap-4 px-5 py-6 transition hover:bg-blue-50/40 sm:gap-5 sm:px-7">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-700">
                  <svg aria-hidden="true" viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.8"><path strokeLinecap="round" strokeLinejoin="round" d="M4 7h16M4 7l2-3h12l2 3M5 7v12a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V7M9 11h6m-6 4h4" /></svg>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2.5">
                    <h3 className="text-lg font-semibold text-slate-950">应用更新系统</h3>
                    <span className="rounded-full bg-blue-50 px-2.5 py-1 text-[11px] font-medium text-blue-700">实验中</span>
                  </div>
                  <p className="mt-1.5 text-sm leading-6 text-slate-600">发现应用新版本，审核更新日志、公开下载资料并批量导出。</p>
                  <p className="mt-2 text-xs text-slate-400">/app-updates · 仅超管</p>
                </div>
                <span className="shrink-0 text-blue-600 transition-transform group-hover:translate-x-1"><ArrowIcon /></span>
              </Link>
            )}
          </div>
        </section>

        <footer className="mt-8 flex flex-col gap-1 text-xs text-slate-400 sm:flex-row sm:items-center sm:justify-between">
          <span>奇心内部工作系统</span>
          <span>{role === 'super' ? '当前账号可以访问超管实验功能' : '系统权限由当前账号角色决定'}</span>
        </footer>
      </main>
    </div>
  )
}
