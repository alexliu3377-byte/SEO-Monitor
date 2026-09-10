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
    <div className="relative min-h-screen overflow-hidden bg-slate-950 text-white">
      <div aria-hidden="true" className="absolute inset-0 bg-[radial-gradient(circle_at_16%_20%,rgba(16,185,129,0.18),transparent_28%),radial-gradient(circle_at_84%_78%,rgba(59,130,246,0.2),transparent_32%)]" />
      <div aria-hidden="true" className="absolute inset-0 opacity-[0.035] [background-image:linear-gradient(rgba(255,255,255,.8)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.8)_1px,transparent_1px)] [background-size:48px_48px]" />

      <main className="relative mx-auto flex min-h-screen max-w-6xl flex-col px-5 py-8 sm:px-8 sm:py-10">
        <header className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-white text-lg font-black text-slate-950 shadow-lg shadow-black/20">奇</div>
            <div>
              <p className="font-semibold tracking-wide">奇心工作台</p>
              <p className="mt-0.5 text-xs text-slate-400">后台系统入口</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden max-w-56 truncate text-xs text-slate-400 sm:block">{email}</span>
            <button type="button" onClick={logout} className="rounded-lg border border-white/10 px-3 py-2 text-xs font-medium text-slate-300 transition hover:border-white/20 hover:bg-white/5 hover:text-white">退出登录</button>
          </div>
        </header>

        <section className="flex flex-1 flex-col justify-center py-16 sm:py-20">
          <div className="max-w-2xl">
            <p className="text-xs font-bold uppercase tracking-[0.24em] text-emerald-400">System workspace</p>
            <h1 className="mt-4 text-4xl font-bold tracking-tight sm:text-5xl">选择要进入的后台</h1>
            <p className="mt-4 text-base leading-7 text-slate-400">各系统使用同一账号登录，但拥有独立的工作入口、导航和任务范围。</p>
          </div>

          <div className={`mt-10 grid gap-5 ${role === 'super' ? 'lg:grid-cols-2' : 'max-w-2xl'}`}>
            <Link href="/content" className="group relative overflow-hidden rounded-3xl border border-emerald-400/20 bg-gradient-to-br from-emerald-500/15 to-slate-900 p-6 shadow-2xl shadow-black/20 transition duration-200 hover:-translate-y-1 hover:border-emerald-400/45 sm:p-8">
              <div className="flex items-start justify-between gap-5">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-500 text-white shadow-lg shadow-emerald-950/40">
                  <svg aria-hidden="true" viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.8"><path strokeLinecap="round" strokeLinejoin="round" d="M4 19V9m5 10V5m5 14v-7m5 7V3" /></svg>
                </div>
                <span className="rounded-full border border-emerald-300/20 bg-emerald-400/10 px-2.5 py-1 text-[11px] font-semibold text-emerald-300">正式使用</span>
              </div>
              <h2 className="mt-8 text-2xl font-bold">内容发布系统</h2>
              <p className="mt-3 min-h-14 text-sm leading-6 text-slate-400">站点监控、任务协作、成效报告、研究中心与日常内容运营。</p>
              <div className="mt-7 flex items-center justify-between border-t border-white/10 pt-5 text-sm font-semibold text-emerald-300">
                <span>进入首页快报</span><span className="transition-transform group-hover:translate-x-1"><ArrowIcon /></span>
              </div>
            </Link>

            {role === 'super' && (
              <Link href="/app-updates" className="group relative overflow-hidden rounded-3xl border border-blue-400/20 bg-gradient-to-br from-blue-500/15 to-slate-900 p-6 shadow-2xl shadow-black/20 transition duration-200 hover:-translate-y-1 hover:border-blue-400/45 sm:p-8">
                <div className="flex items-start justify-between gap-5">
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-600 text-white shadow-lg shadow-blue-950/40">
                    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.8"><path strokeLinecap="round" strokeLinejoin="round" d="M4 7h16M4 7l2-3h12l2 3M5 7v12a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V7M9 11h6m-6 4h4" /></svg>
                  </div>
                  <span className="rounded-full border border-blue-300/20 bg-blue-400/10 px-2.5 py-1 text-[11px] font-semibold text-blue-300">实验中</span>
                </div>
                <h2 className="mt-8 text-2xl font-bold">应用更新系统</h2>
                <p className="mt-3 min-h-14 text-sm leading-6 text-slate-400">发现应用新版本，审核更新日志、公开下载资料并批量导出。</p>
                <div className="mt-7 flex items-center justify-between border-t border-white/10 pt-5 text-sm font-semibold text-blue-300">
                  <span>进入更新工作台</span><span className="transition-transform group-hover:translate-x-1"><ArrowIcon /></span>
                </div>
              </Link>
            )}
          </div>
        </section>

        <footer className="flex flex-col gap-1 border-t border-white/10 pt-5 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between">
          <span>奇心内部工作系统</span>
          <span>{role === 'super' ? '超管可访问实验后台' : '当前账号仅显示可用后台'}</span>
        </footer>
      </main>
    </div>
  )
}
