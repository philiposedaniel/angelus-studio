import type { Metadata } from 'next'
import { Cormorant_Garamond, Inter } from 'next/font/google'
import { notFound } from 'next/navigation'

import { SiteFooter } from '@/components/SiteFooter'
import { SiteHeader } from '@/components/SiteHeader'
import { getDictionary } from '@/i18n/dictionaries'
import { resolveLocale, tenantLocales } from '@/lib/locale'
import { getMenuPages, getSiteSettings } from '@/lib/site'
import { getCurrentTenant } from '@/lib/tenant'
import './styles.css'

const display = Cormorant_Garamond({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-cormorant',
  display: 'swap',
})

const sans = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' })

export const dynamic = 'force-dynamic'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const tenant = await getCurrentTenant()
  if (!tenant) return {}
  const locale = await resolveLocale(tenant, (await params).locale)
  const settings = await getSiteSettings(tenant.id, locale)
  const name = settings?.companyName ?? tenant.name
  const offered = tenantLocales(tenant)
  return {
    metadataBase: process.env.NEXT_PUBLIC_SERVER_URL
      ? new URL(process.env.NEXT_PUBLIC_SERVER_URL)
      : undefined,
    title: { default: name, template: `%s | ${name}` },
    description: settings?.tagline ?? undefined,
    alternates: {
      canonical: `/${locale}`,
      languages: Object.fromEntries(offered.map((code) => [code, `/${code}`])),
    },
    openGraph: { siteName: name, type: 'website', locale },
  }
}

export default async function FrontendLayout({ children, params }: LayoutProps<'/[locale]'>) {
  const tenant = await getCurrentTenant()
  if (!tenant) notFound()
  const locale = await resolveLocale(tenant, (await params).locale)
  const [settings, menuPages] = await Promise.all([
    getSiteSettings(tenant.id, locale),
    getMenuPages(tenant.id, locale),
  ])
  const dictionary = getDictionary(locale)
  const companyName = settings?.companyName ?? tenant.name

  return (
    <html lang={locale} className={`${display.variable} ${sans.variable}`}>
      <body className="flex min-h-screen flex-col">
        <a
          href="#main"
          className="sr-only z-50 bg-gold px-4 py-2 text-ink focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
        >
          {dictionary.nav.skipToContent}
        </a>
        <SiteHeader
          companyName={companyName}
          locale={locale}
          locales={tenantLocales(tenant)}
          dictionary={dictionary}
          menuPages={menuPages}
        />
        <main id="main" className="flex-1">
          {children}
        </main>
        <SiteFooter
          companyName={companyName}
          socialLinks={settings?.socialLinks ?? []}
          dictionary={dictionary}
        />
      </body>
    </html>
  )
}
