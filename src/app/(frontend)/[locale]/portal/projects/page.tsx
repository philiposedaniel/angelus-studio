import config from '@payload-config'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getPayload } from 'payload'

import { getDictionary } from '@/i18n/dictionaries'
import { requirePortalUser } from '@/lib/auth'
import { resolveLocale } from '@/lib/locale'
import { getCurrentTenant } from '@/lib/tenant'

export const metadata = { robots: { index: false } }

export default async function PortalProjects({ params }: PageProps<'/[locale]/portal/projects'>) {
  const tenant = await getCurrentTenant()
  if (!tenant) notFound()
  const locale = await resolveLocale(tenant, (await params).locale)
  const user = await requirePortalUser(tenant, locale)
  const t = getDictionary(locale).portal
  const payload = await getPayload({ config })

  // Access rules limit this to the productions the user works on or is the client of.
  const { docs: projects } = await payload.find({
    collection: 'projects',
    user,
    overrideAccess: false,
    where: { tenant: { equals: tenant.id } },
    sort: 'shootDate',
    depth: 0,
    limit: 100,
    locale,
  })

  return (
    <section className="mx-auto max-w-7xl px-4 py-20 sm:px-8">
      <Link href={`/${locale}/portal`} className="text-sm text-mist hover:text-ivory">
        ← {t.myGalleries}
      </Link>
      <h1 className="mt-4 font-display text-4xl sm:text-5xl">{t.myProjects}</h1>
      {projects.length === 0 ? (
        <p className="mt-8 text-mist">{t.noProjects}</p>
      ) : (
        <ul className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((project) => (
            <li key={project.id} className="rounded-2xl border border-ivory/10 bg-charcoal p-6">
              <h2 className="font-display text-2xl">{project.title}</h2>
              <p className="mt-2 text-sm text-gold">{t.projectStatus[project.status]}</p>
              {project.shootDate && (
                <p className="mt-4 text-sm text-mist">
                  {t.shootDay}:{' '}
                  {new Date(project.shootDate).toLocaleDateString(locale, { dateStyle: 'long', timeZone: 'UTC' })}
                </p>
              )}
              {project.location && (
                <p className="mt-1 text-sm text-mist">
                  {t.location}: {project.location}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
