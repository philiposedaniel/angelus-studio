import { getDictionary } from '@/i18n/dictionaries'
import { shareLocale } from '@/lib/shareLocale'
import { getCurrentTenant } from '@/lib/tenant'

export default async function SharedAlbumNotFound() {
  const tenant = await getCurrentTenant()
  const t = getDictionary(tenant ? await shareLocale(tenant) : 'en').album
  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center px-6 py-16 text-center">
      <h1 className="font-display text-4xl">{t.unavailableTitle}</h1>
      <p className="mt-4 text-mist">{t.unavailableText}</p>
    </main>
  )
}
