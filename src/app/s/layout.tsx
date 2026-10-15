import type { Metadata } from 'next'
import { Cormorant_Garamond, Inter } from 'next/font/google'

import { shareLocale } from '@/lib/shareLocale'
import { getCurrentTenant } from '@/lib/tenant'
import '../(frontend)/[locale]/styles.css'

const display = Cormorant_Garamond({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-cormorant',
  display: 'swap',
})

const sans = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' })

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  // Shared albums are private to whoever has the link.
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
}

/** Shared albums and embeds: no site header or footer, just the photos. */
export default async function ShareLayout({ children }: LayoutProps<'/s'>) {
  const tenant = await getCurrentTenant()
  const lang = tenant ? await shareLocale(tenant) : 'en'
  return (
    <html lang={lang} className={`${display.variable} ${sans.variable}`}>
      <body className="min-h-screen">{children}</body>
    </html>
  )
}
