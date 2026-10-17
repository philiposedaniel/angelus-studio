import config from '@payload-config'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getPayload } from 'payload'

import { getDictionary } from '@/i18n/dictionaries'
import { requirePortalUser } from '@/lib/auth'
import { type CalendarProject, parseMonth, productionsInMonth, shiftMonth } from '@/lib/calendar'
import { resolveLocale } from '@/lib/locale'
import { getCurrentTenant } from '@/lib/tenant'

export const metadata = { robots: { index: false } }

/** The studio's productions by shoot day for one month. Shows only what the user is allowed to see. */
export default async function CalendarPage({ params, searchParams }: PageProps<'/[locale]/portal/calendar'>) {
  const tenant = await getCurrentTenant()
  if (!tenant) notFound()
  const locale = await resolveLocale(tenant, (await params).locale)
  const user = await requirePortalUser(tenant, locale)
  const t = getDictionary(locale).portal
  const month = parseMonth((await searchParams).month)
  const payload = await getPayload({ config })
  const projects = await productionsInMonth(payload, user, tenant, month)

  // Group by the shoot day, in the order the query returned them.
  const days = new Map<string, CalendarProject[]>()
  for (const project of projects) {
    const day = project.shootDate.slice(0, 10)
    days.set(day, [...(days.get(day) ?? []), project])
  }

  const monthLabel = new Date(Date.UTC(month.year, month.month - 1, 1)).toLocaleDateString(locale, {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })
  const dayLabel = (day: string) =>
    new Date(`${day}T00:00:00.000Z`).toLocaleDateString(locale, {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      timeZone: 'UTC',
    })
  const previous = shiftMonth(month, -1)
  const next = shiftMonth(month, 1)

  return (
    <section className="mx-auto max-w-4xl px-4 py-20 sm:px-8">
      <h1 className="font-display text-4xl sm:text-5xl">{t.calendarHeading}</h1>
      <nav className="mt-8 flex items-center justify-between gap-4" aria-label={monthLabel}>
        <Link href={`/${locale}/portal/calendar?month=${previous.value}`} className="text-gold hover:underline">
          ← {t.calendarPrevious}
        </Link>
        <p className="font-display text-2xl capitalize">{monthLabel}</p>
        <Link href={`/${locale}/portal/calendar?month=${next.value}`} className="text-gold hover:underline">
          {t.calendarNext} →
        </Link>
      </nav>

      {days.size === 0 ? (
        <p className="mt-12 text-mist">{t.calendarEmpty}</p>
      ) : (
        <div className="mt-12 grid gap-8">
          {[...days.entries()].map(([day, dayProjects]) => (
            <section key={day} aria-labelledby={`day-${day}`}>
              <h2 id={`day-${day}`} className="font-display text-2xl capitalize">
                {dayLabel(day)}
              </h2>
              <ul className="mt-4 grid gap-3">
                {dayProjects.map((project) => (
                  <li key={project.id} className="rounded-2xl border border-ivory/10 bg-charcoal p-5">
                    <h3 className="font-display text-xl">{project.title}</h3>
                    <p className="mt-1 text-sm text-mist">
                      {t.productionStatus[project.status as keyof typeof t.productionStatus] ?? project.status}
                      {project.location && ` · ${t.calendarLocation}: ${project.location}`}
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </section>
  )
}
