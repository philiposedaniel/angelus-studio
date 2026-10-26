import { notFound } from 'next/navigation'
import { getPayload } from 'payload'
import config from '@payload-config'

import { getDictionary } from '@/i18n/dictionaries'
import { monthBounds, parseMonth, shiftMonth } from '@/lib/calendar'
import { busyDays, dayIn, dayStatus, STUDIO_TIME_ZONE } from '@/lib/availability'
import { resolveLocale } from '@/lib/locale'
import { getCurrentTenant } from '@/lib/tenant'

const MONTHS_SHOWN = 3

/** The studio's booked days for the next three months. Shows days only, never what the booking is for. */
export default async function AvailabilityPage({ params }: PageProps<'/[locale]/availability'>) {
  const tenant = await getCurrentTenant()
  if (!tenant) notFound()
  const locale = await resolveLocale(tenant, (await params).locale)
  const t = getDictionary(locale).availability

  const first = parseMonth(undefined)
  const months = Array.from({ length: MONTHS_SHOWN }, (_, index) => shiftMonth(first, index))
  const payload = await getPayload({ config })
  const booked = new Set(
    await busyDays(payload, tenant.id, {
      start: monthBounds(first).start,
      end: monthBounds(months[MONTHS_SHOWN - 1]!).end,
    }),
  )

  // The studio's today, so days already gone are not shown as free.
  const today = dayIn(new Date().toISOString(), STUDIO_TIME_ZONE)

  // Monday-first weekday names, from a known week.
  const weekdays = Array.from({ length: 7 }, (_, index) =>
    new Date(Date.UTC(2024, 0, 1 + index)).toLocaleDateString(locale, {
      weekday: 'short',
      timeZone: 'UTC',
    }),
  )

  return (
    <div className="mx-auto grid max-w-4xl gap-10 px-6 py-16 text-ivory">
      <header className="grid gap-3">
        <h1 className="font-serif text-4xl">{t.heading}</h1>
        <p className="text-mist">{t.intro}</p>
      </header>

      {months.map((month) => {
        const daysInMonth = new Date(Date.UTC(month.year, month.month, 0)).getUTCDate()
        // Leading blanks so the first day falls on its weekday (Monday first).
        const leading = (new Date(Date.UTC(month.year, month.month - 1, 1)).getUTCDay() + 6) % 7
        const title = new Date(Date.UTC(month.year, month.month - 1, 1)).toLocaleDateString(
          locale,
          {
            month: 'long',
            year: 'numeric',
            timeZone: 'UTC',
          },
        )
        return (
          <section key={month.value} className="grid gap-3" aria-label={title}>
            <h2 className="font-serif text-2xl capitalize">{title}</h2>
            <div className="grid grid-cols-7 gap-1 text-center text-sm">
              {weekdays.map((name) => (
                <span key={name} className="py-1 text-mist">
                  {name}
                </span>
              ))}
              {Array.from({ length: leading }, (_, index) => (
                <span key={`blank-${index}`} />
              ))}
              {Array.from({ length: daysInMonth }, (_, index) => {
                const day = index + 1
                const iso = `${month.year}-${String(month.month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
                const status = dayStatus(iso, today, booked)
                const style = {
                  booked: {
                    box: 'border-gold/60 bg-gold/10',
                    label: 'text-xs text-gold',
                    text: t.booked,
                  },
                  open: { box: 'border-ivory/10', label: 'text-xs text-mist', text: t.open },
                  past: {
                    box: 'border-ivory/5 bg-ivory/[0.02]',
                    label: 'text-xs text-mist',
                    text: t.past,
                  },
                }[status]
                return (
                  <span
                    key={iso}
                    className={`grid min-h-14 content-start gap-1 rounded-lg border p-2 text-left ${style.box}`}
                  >
                    <span>{day}</span>
                    <span className={style.label}>{style.text}</span>
                  </span>
                )
              })}
            </div>
          </section>
        )
      })}
    </div>
  )
}
