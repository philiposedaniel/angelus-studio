'use client'

import { ChevronLeft, ChevronRight, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'

import { cn } from '@/lib/cn'

export type AlbumImage = { src: string; width: number; height: number }

export type AlbumPhoto = {
  id: number
  alt: string
  thumb: AlbumImage
  large: AlbumImage
}

export type AlbumLabels = {
  open: string
  close: string
  previous: string
  next: string
  /** e.g. "{n} of {total}" */
  position: string
}

type Props = {
  photos: AlbumPhoto[]
  labels: AlbumLabels
  /** Extra controls drawn over a tile, such as favorite or download buttons. */
  tileExtras?: Record<number, ReactNode>
  /** Target row height in pixels on wide screens; rows shrink on phones. */
  rowHeight?: number
  className?: string
}

/** Swipes shorter than this (in pixels) are treated as taps. */
const SWIPE_MIN = 40

/**
 * A justified photo grid (rows of equal height, photos keep their shape, like Google Photos)
 * with a full-screen viewer: arrow keys, swipe, Escape to close.
 */
export function PhotoAlbum({ photos, labels, tileExtras, rowHeight = 240, className }: Props) {
  const dialog = useRef<HTMLDialogElement>(null)
  const opener = useRef<HTMLElement | null>(null)
  const swipeStart = useRef<number | null>(null)
  const [index, setIndex] = useState<number | null>(null)

  const open = (i: number, from: HTMLElement) => {
    opener.current = from
    setIndex(i)
    dialog.current?.showModal()
  }
  const close = () => dialog.current?.close()
  const step = useCallback(
    (delta: number) =>
      setIndex((current) =>
        current === null ? current : (current + delta + photos.length) % photos.length,
      ),
    [photos.length],
  )

  useEffect(() => {
    const node = dialog.current
    if (!node) return
    const onClose = () => {
      setIndex(null)
      opener.current?.focus()
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'ArrowRight') step(1)
      if (event.key === 'ArrowLeft') step(-1)
    }
    node.addEventListener('close', onClose)
    node.addEventListener('keydown', onKey)
    return () => {
      node.removeEventListener('close', onClose)
      node.removeEventListener('keydown', onKey)
    }
  }, [step])

  const current = index === null ? null : photos[index]
  // Preload the neighbours so moving through the album feels instant.
  const neighbours =
    index === null || photos.length < 2
      ? []
      : [photos[(index + 1) % photos.length]!, photos[(index - 1 + photos.length) % photos.length]!]

  const control =
    'flex size-12 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur transition-colors hover:bg-white/20 focus-visible:outline-2 focus-visible:outline-white'

  return (
    <>
      <ul
        className={cn(
          'flex flex-wrap gap-1 [--row:140px] after:grow-[999999] after:content-[""] sm:[--row:var(--row-lg)]',
          className,
        )}
        style={{ '--row-lg': `${rowHeight}px` } as React.CSSProperties}
      >
        {photos.map((photo, i) => {
          const ratio = photo.thumb.width / photo.thumb.height
          return (
            <li
              key={photo.id}
              className="group relative overflow-hidden bg-white/5"
              style={{ flexGrow: ratio * 100, flexBasis: `calc(var(--row) * ${ratio})` }}
            >
              <span className="block" style={{ paddingBottom: `${100 / ratio}%` }} />
              <button
                type="button"
                onClick={(event) => open(i, event.currentTarget)}
                aria-label={`${labels.open} ${i + 1}`}
                className="absolute inset-0 cursor-zoom-in focus-visible:outline-2 focus-visible:outline-offset-[-4px] focus-visible:outline-white"
              >
                {/* Private files are served with a session or share link, so no image optimizer. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={photo.thumb.src}
                  alt={photo.alt}
                  width={photo.thumb.width}
                  height={photo.thumb.height}
                  loading="lazy"
                  decoding="async"
                  className="size-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
                />
              </button>
              {tileExtras?.[photo.id]}
            </li>
          )
        })}
      </ul>

      <dialog
        ref={dialog}
        aria-label={current?.alt || labels.open}
        className="m-0 h-dvh max-h-none w-dvw max-w-none bg-black p-0 text-white backdrop:bg-black"
        onPointerDown={(event) => {
          swipeStart.current = event.clientX
        }}
        onPointerUp={(event) => {
          if (swipeStart.current === null) return
          const distance = event.clientX - swipeStart.current
          swipeStart.current = null
          if (Math.abs(distance) >= SWIPE_MIN) step(distance < 0 ? 1 : -1)
        }}
      >
        {current && (
          <div className="relative flex size-full items-center justify-center select-none">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              key={current.id}
              src={current.large.src}
              alt={current.alt}
              width={current.large.width}
              height={current.large.height}
              draggable={false}
              className="max-h-full max-w-full object-contain"
            />
            {neighbours.map((photo) => (
              <link key={photo.id} rel="preload" as="image" href={photo.large.src} />
            ))}
            <p className="absolute top-4 left-4 text-sm text-white/80" aria-live="polite">
              {labels.position
                .replace('{n}', String(index! + 1))
                .replace('{total}', String(photos.length))}
            </p>
            <button
              type="button"
              onClick={close}
              aria-label={labels.close}
              className={cn(control, 'absolute top-3 right-3')}
              autoFocus
            >
              <X aria-hidden="true" className="size-6" />
            </button>
            {photos.length > 1 && (
              <>
                <button
                  type="button"
                  onClick={() => step(-1)}
                  aria-label={labels.previous}
                  className={cn(control, 'absolute top-1/2 left-3 -translate-y-1/2')}
                >
                  <ChevronLeft aria-hidden="true" className="size-7" />
                </button>
                <button
                  type="button"
                  onClick={() => step(1)}
                  aria-label={labels.next}
                  className={cn(control, 'absolute top-1/2 right-3 -translate-y-1/2')}
                >
                  <ChevronRight aria-hidden="true" className="size-7" />
                </button>
              </>
            )}
          </div>
        )}
      </dialog>
    </>
  )
}
