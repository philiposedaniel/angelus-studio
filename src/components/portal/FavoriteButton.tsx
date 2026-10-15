'use client'

import { Heart } from 'lucide-react'
import { useState } from 'react'

import { cn } from '@/lib/cn'

type Props = {
  photoId: number
  initialFavoriteId: number | null
  labels: { favorite: string; unfavorite: string; error: string }
}

export function FavoriteButton({ photoId, initialFavoriteId, labels }: Props) {
  const [favoriteId, setFavoriteId] = useState(initialFavoriteId)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState(false)
  const active = favoriteId !== null

  async function toggle() {
    setPending(true)
    setError(false)
    const response = active
      ? await fetch(`/api/gallery-favorites/${favoriteId}`, { method: 'DELETE', credentials: 'include' })
      : await fetch('/api/gallery-favorites', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ photo: photoId }),
        })
    if (response.ok) {
      if (active) setFavoriteId(null)
      else setFavoriteId(((await response.json()) as { doc: { id: number } }).doc.id)
    } else {
      setError(true)
    }
    setPending(false)
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={pending}
      aria-pressed={active}
      aria-label={active ? labels.unfavorite : labels.favorite}
      title={error ? labels.error : active ? labels.unfavorite : labels.favorite}
      className={cn(
        'flex size-10 items-center justify-center rounded-full bg-ink/70 backdrop-blur transition-colors hover:text-gold disabled:opacity-60',
        active ? 'text-gold' : 'text-ivory',
        error && 'ring-2 ring-copper',
      )}
    >
      <Heart aria-hidden="true" className={cn('size-5', active && 'fill-current')} />
    </button>
  )
}
