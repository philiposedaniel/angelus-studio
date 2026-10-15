import Link from 'next/link'
import type { ComponentProps } from 'react'

import { cn } from '@/lib/cn'

type Variant = 'primary' | 'outline'

const variants: Record<Variant, string> = {
  primary: 'bg-gold text-ink hover:bg-ivory',
  outline: 'border border-ivory/40 text-ivory hover:border-gold hover:text-gold',
}

export function ButtonLink({
  variant = 'primary',
  className,
  ...props
}: ComponentProps<typeof Link> & { variant?: Variant }) {
  return (
    <Link
      className={cn(
        'inline-flex items-center justify-center rounded-full px-7 py-3 text-sm font-medium tracking-wide uppercase transition-colors',
        variants[variant],
        className,
      )}
      {...props}
    />
  )
}
