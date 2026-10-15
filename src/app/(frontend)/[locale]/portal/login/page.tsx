import { notFound, redirect } from 'next/navigation'

import { LoginForm } from '@/components/portal/LoginForm'
import { getDictionary } from '@/i18n/dictionaries'
import { getSessionUser } from '@/lib/auth'
import { resolveLocale } from '@/lib/locale'
import { getCurrentTenant } from '@/lib/tenant'

export const metadata = { robots: { index: false } }

export default async function LoginPage({ params }: PageProps<'/[locale]/portal/login'>) {
  const tenant = await getCurrentTenant()
  if (!tenant) notFound()
  const locale = await resolveLocale(tenant, (await params).locale)
  if (await getSessionUser()) redirect(`/${locale}/portal`)
  const t = getDictionary(locale).portal

  return (
    <section className="mx-auto max-w-md px-4 py-24 sm:px-8">
      <h1 className="font-display text-4xl sm:text-5xl">{t.loginTitle}</h1>
      <p className="mt-4 text-mist">{t.loginIntro}</p>
      <LoginForm
        redirectTo={`/${locale}/portal`}
        labels={{
          email: t.email,
          password: t.password,
          signIn: t.signIn,
          signingIn: t.signingIn,
          loginFailed: t.loginFailed,
        }}
      />
    </section>
  )
}
