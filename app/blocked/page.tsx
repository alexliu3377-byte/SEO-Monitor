'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

export default function BlockedPage() {
  const [ip, setIp] = useState('检测中...')
  const router = useRouter()

  useEffect(() => {
    fetch('/api/my-ip')
      .then(r => r.json())
      .then(d => setIp(d.ip ?? '未知'))
      .catch(() => setIp('未知'))
  }, [])

  async function handleLogout() {
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        cache: 'no-store',
        credentials: 'same-origin',
      })
    } finally {
      router.replace('/login')
      router.refresh()
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-lg p-8 text-center">
        <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <svg className="w-8 h-8 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
          </svg>
        </div>
        <h1 className="text-xl font-bold text-gray-900 mb-2">访问受限</h1>
        <p className="text-gray-500 text-sm mb-2">您的 IP 地址不在访问白名单中</p>
        <p className="text-gray-400 text-xs font-mono bg-gray-50 rounded px-3 py-1.5 inline-block mb-6">
          当前 IP：{ip}
        </p>
        <p className="text-gray-400 text-xs mb-8">请联系管理员将您的 IP 加入白名单，或解除限制</p>
        <button
          onClick={handleLogout}
          className="px-6 py-2.5 bg-gray-800 text-white text-sm font-medium rounded-lg hover:bg-gray-700 transition-colors"
        >
          退出登录
        </button>
      </div>
    </div>
  )
}
