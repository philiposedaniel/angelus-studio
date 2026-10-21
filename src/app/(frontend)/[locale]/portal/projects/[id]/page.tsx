import config from '@payload-config'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getPayload } from 'payload'

import { PrintButton } from '@/components/portal/PrintButton'
import { getDictionary } from '@/i18n/dictionaries'
import { requirePortalUser } from '@/lib/auth'
import { resolveLocale } from '@/lib/locale'
import { getCurrentTenant } from '@/lib/tenant'

/** Largest Postgres integer id. A bigger id fails in the query, so it is not found here. Switch to src/lib/ids.ts once #64 is on main. */
const MAX_ROW_ID = 2147483647

export const metadata = { robots: { index: false } }

/** One production the user works on or is the client of. The call sheet shows only to staff and crew. */
export default async function PortalProject({ params }: PageProps<'/[locale]/portal/projects/[id]'>) {
  const tenant = await getCurrentTenant()
  if (!tenant) notFound()
  const { locale: requested, id } = await params
  const locale = await resolveLocale(tenant, requested)
  const user = await requirePortalUser(tenant, locale)
  const numericId = Number(id)
  if (!Number.isInteger(numericId) || numericId <= 0 || numericId > MAX_ROW_ID) notFound()
  const t = getDictionary(locale).portal
  const payload = await getPayload({ config })

  // Access rules decide what this user may read. A client gets no call sheet at all: the field is
  // left out of the result for them, so the page only shows it when it is there.
  const { docs } = await payload.find({
    collection: 'projects',
    user,
    overrideAccess: false,
    where: { and: [{ tenant: { equals: tenant.id } }, { id: { equals: numericId } }] },
    depth: 0,
    limit: 1,
    locale,
  })
  const project = docs[0]
  if (!project) notFound()

  const callSheet = project.callSheet
  const hasCallSheet = Boolean(callSheet?.meetingPoint || callSheet?.notes || callSheet?.schedule?.length)

  return (
    <section className="mx-auto max-w-3xl px-4 py-20 sm:px-8">
      <Link href={`/${locale}/portal/projects`} className="text-sm text-mist hover:text-ivory print:hidden">
        ← {t.myProjects}
      </Link>
      <h1 className="mt-4 font-display text-4xl sm:text-5xl">{project.title}</h1>
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

      {callSheet && (
        <section aria-labelledby="call-sheet" className="mt-12 grid gap-8">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <h2 id="call-sheet" className="font-display text-3xl">
              {t.callSheetHeading}
            </h2>
            <PrintButton label={t.printCallSheet} />
          </div>
          {!hasCallSheet && <p className="text-mist">{t.noCallSheet}</p>}
          {callSheet.meetingPoint && (
            <div className="grid gap-2">
              <h3 className="text-sm text-gold">{t.meetingPoint}</h3>
              <p>{callSheet.meetingPoint}</p>
            </div>
          )}
          {callSheet.notes && (
            <div className="grid gap-2">
              <h3 className="text-sm text-gold">{t.crewNotes}</h3>
              <p className="whitespace-pre-line text-mist">{callSheet.notes}</p>
            </div>
          )}
          {hasCallSheet && (
            <div className="grid gap-2">
              <h3 className="text-sm text-gold">{t.schedule}</h3>
              {callSheet.schedule?.length ? (
                <ol className="grid gap-3">
                  {callSheet.schedule.map((row, index) => (
                    <li key={row.id ?? index} className="grid grid-cols-[4rem_1fr] gap-4 border-b border-ivory/10 pb-3">
                      <span className="font-medium text-gold">{row.time}</span>
                      <span>
                        {row.item}
                        {row.location && <span className="block text-sm text-mist">{row.location}</span>}
                      </span>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="text-mist">{t.noSchedule}</p>
              )}
            </div>
          )}
        </section>
      )}
    </section>
  )
}
