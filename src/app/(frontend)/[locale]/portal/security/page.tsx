import { notFound } from 'next/navigation'

import { getDictionary } from '@/i18n/dictionaries'
import { requirePortalUser } from '@/lib/auth'
import { resolveLocale } from '@/lib/locale'
import { generateTotpSecret, totpUri } from '@/lib/totp'
import { getCurrentTenant } from '@/lib/tenant'

import { disableMfaAction, enableMfaAction } from './actions'

export const metadata = { robots: { index: false } }

const STATUS_KEYS = {
  enabled: 'securityEnabled',
  disabled: 'securityDisabled',
  invalid: 'securityInvalid',
  locked: 'securityLocked',
} as const

const inputClass =
  'mt-2 w-full rounded-xl border border-ivory/20 bg-charcoal px-4 py-3 text-ivory placeholder:text-mist/60 focus:border-gold focus:outline-none'
const buttonClass =
  'rounded-full bg-gold px-7 py-3 text-sm font-medium tracking-wide text-ink uppercase transition-colors hover:bg-ivory'

/** Staff turn on authenticator sign-in here. Everyone else can open the page and see that it is off. */
export default async function SecurityPage({ params, searchParams }: PageProps<'/[locale]/portal/security'>) {
  const tenant = await getCurrentTenant()
  if (!tenant) notFound()
  const locale = await resolveLocale(tenant, (await params).locale)
  const user = await requirePortalUser(tenant, locale)
  const t = getDictionary(locale).portal
  const status = (await searchParams).status
  const notice = typeof status === 'string' && status in STATUS_KEYS ? t[STATUS_KEYS[status as keyof typeof STATUS_KEYS]] : null

  // The secret is made fresh for each visit and only saved once the person proves they can read a code from it.
  const secret = generateTotpSecret()
  const uri = totpUri({ secret, account: user.email, issuer: tenant.name })

  return (
    <section className="mx-auto max-w-2xl px-4 py-20 sm:px-8">
      <h1 className="font-display text-4xl sm:text-5xl">{t.securityHeading}</h1>
      <p className="mt-4 text-mist">{t.securityIntro}</p>
      {notice && (
        <p role="status" className="mt-6 text-gold">
          {notice}
        </p>
      )}

      {user.mfaEnabled ? (
        <div className="mt-10 space-y-6">
          <p className="text-ivory">{t.securityOn}</p>
          <form action={disableMfaAction} className="space-y-4">
            <input type="hidden" name="locale" value={locale} />
            <label className="block text-sm text-mist">
              {t.securityCode}
              <input
                name="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9 ]{6,7}"
                required
                className={inputClass}
              />
            </label>
            <button type="submit" className={buttonClass}>
              {t.securityDisable}
            </button>
          </form>
        </div>
      ) : (
        <div className="mt-10 space-y-6">
          <p className="text-ivory">{t.securityOff}</p>
          <p className="text-sm text-mist">{t.securitySetupHint}</p>
          <p className="text-sm text-mist">
            {t.securitySetupKey}:{' '}
            <code className="break-all font-mono tracking-wider text-ivory">{secret}</code>
          </p>
          <p className="text-sm">
            <a href={uri} className="text-gold hover:underline">
              {t.securityOpenApp}
            </a>
          </p>
          <form action={enableMfaAction} className="space-y-4">
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="secret" value={secret} />
            <label className="block text-sm text-mist">
              {t.securityCode}
              <input
                name="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9 ]{6,7}"
                required
                className={inputClass}
              />
            </label>
            <button type="submit" className={buttonClass}>
              {t.securityEnable}
            </button>
          </form>
        </div>
      )}
    </section>
  )
}
