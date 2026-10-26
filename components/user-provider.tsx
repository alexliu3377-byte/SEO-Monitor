'use client'

import { useEffect } from 'react'
import { UserContext, type UserProfile } from '@/lib/user-context'
import { clearRetiredWorkspaceStorage } from '@/lib/retired-workspace-storage'

export default function UserProvider({
  profile,
  children,
}: {
  profile: UserProfile | null
  children: React.ReactNode
}) {
  useEffect(() => {
    try {
      clearRetiredWorkspaceStorage(window.localStorage)
    } catch {
      // Some browsers disallow accessing localStorage entirely.
    }
  }, [])

  return (
    <UserContext.Provider value={profile}>
      {children}
    </UserContext.Provider>
  )
}
