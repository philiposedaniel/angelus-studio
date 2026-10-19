import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { RenderBlocks } from '@/components/blocks/RenderBlocks'
import { resolveLocale, tenantLocales } from '@/lib/locale'
import { siteOrigin } from '@/lib/seo'
import { getPublishedPage } from '@/lib/site'
import { getCurrentTenant } from '@/lib/tenant'

export async function generateMetadata({
  params,
}: PageProps<'/[locale]/[slug]'>): Promise<Metadata> {
  const tenant = await getCurrentTenant()
  if (!tenant) return {}
  const { locale: requested, slug } = await params
  const locale = await resolveLocale(tenant, requested)
  const page = await getPublishedPage(tenant.id, slug, locale)
  if (!page) return {}
  const origin = siteOrigin(tenant)
  return {
    title: page.title,
    description: page.intro ?? undefined,
    // Canonical and language alternates are absolute, so they only appear once the studio has a domain.
    ...(origin && {
      alternates: {
        canonical: `${origin}/${locale}/${slug}`,
        languages: Object.fromEntries(
          tenantLocales(tenant).map((code) => [code, `${origin}/${code}/${slug}`]),
        ),
      },
    }),
  }
}

/** A website page built in the admin from blocks. */
export default async function WebsitePage({ params }: PageProps<'/[locale]/[slug]'>) {
  const tenant = await getCurrentTenant()
  if (!tenant) notFound()
  const { locale: requested, slug } = await params
  const locale = await resolveLocale(tenant, requested)
  const page = await getPublishedPage(tenant.id, slug, locale)
  if (!page) notFound()

  return (
    <article className="mx-auto max-w-6xl px-4 py-16 sm:px-8">
      <header className="mb-12 max-w-3xl">
        <h1 className="font-display text-4xl sm:text-6xl">{page.title}</h1>
        {page.intro && <p className="mt-4 text-lg text-mist">{page.intro}</p>}
      </header>
      <RenderBlocks blocks={page.layout} locale={locale} tenant={tenant} />
    </article>
  )
}
