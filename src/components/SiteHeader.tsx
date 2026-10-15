import Link from 'next/link'

import { ButtonLink } from './ButtonLink'

const navItems = [
  { href: '/#services', label: 'Services' },
  { href: '/#process', label: 'Process' },
  { href: '/#contact', label: 'Contact' },
]

export function SiteHeader({ companyName }: { companyName: string }) {
  return (
    <header className="sticky top-0 z-40 border-b border-ivory/10 bg-ink/80 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-6 px-4 py-4 sm:px-8">
        <Link href="/" className="font-display text-xl tracking-wide text-ivory sm:text-2xl">
          {companyName}
        </Link>
        <nav aria-label="Main" className="hidden items-center gap-8 md:flex">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="text-sm tracking-wide text-mist transition-colors hover:text-gold"
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <ButtonLink href="/#contact" className="px-5 py-2">
          Book now
        </ButtonLink>
      </div>
    </header>
  )
}
