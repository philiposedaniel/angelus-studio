'use client'

import { useRouter } from 'next/navigation'

export function SignOutButton({ label, redirectTo }: { label: string; redirectTo: string }) {
  const router = useRouter()
  return (
    <button
      type="button"
      onClick={async () => {
        await fetch('/api/users/logout', { method: 'POST', credentials: 'include' }).catch(() => null)
        router.replace(redirectTo)
        router.refresh()
      }}
      className="text-sm text-mist underline-offset-4 transition-colors hover:text-gold hover:underline"
    >
      {label}
    </button>
  )
}
