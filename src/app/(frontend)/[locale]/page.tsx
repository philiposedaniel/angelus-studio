import { Clapperboard, Film, Mail, MapPin, MessageCircle, Phone, Sparkles } from 'lucide-react'
import Image from 'next/image'

import { notFound } from 'next/navigation'

import { ButtonLink } from '@/components/ButtonLink'
import { InquiryForm } from '@/components/InquiryForm'
import { getDictionary } from '@/i18n/dictionaries'
import { issueFormToken } from '@/lib/inquiries'
import { resolveLocale } from '@/lib/locale'
import { getPublishedServices, getSiteSettings } from '@/lib/site'
import { getCurrentTenant } from '@/lib/tenant'
import type { Media } from '@/payload-types'

const asMedia = (value: unknown): Media | null =>
  value && typeof value === 'object' && 'url' in value ? (value as Media) : null

export default async function HomePage({ params }: PageProps<'/[locale]'>) {
  const tenant = await getCurrentTenant()
  if (!tenant) notFound()
  const locale = await resolveLocale(tenant, (await params).locale)
  const [settings, services] = await Promise.all([
    getSiteSettings(tenant.id, locale),
    getPublishedServices(tenant.id, locale),
  ])
  const t = getDictionary(locale)
  const companyName = settings?.companyName ?? tenant.name
  const hero = asMedia(settings?.heroImage)
  const contact = settings?.contact ?? {}

  return (
    <>
      <section
        aria-labelledby="hero-title"
        className="relative isolate flex min-h-[85vh] items-end overflow-hidden"
      >
        {hero?.url ? (
          <Image
            src={hero.url}
            alt={hero.alt}
            fill
            priority
            sizes="100vw"
            className="-z-10 object-cover opacity-60"
          />
        ) : (
          <div
            aria-hidden="true"
            className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_top_right,_rgba(212,183,122,0.25),_transparent_55%),radial-gradient(ellipse_at_bottom_left,_rgba(184,115,51,0.2),_transparent_50%)]"
          />
        )}
        <div
          aria-hidden="true"
          className="absolute inset-0 -z-10 bg-gradient-to-t from-ink via-ink/40 to-transparent"
        />
        <div className="mx-auto w-full max-w-7xl px-4 pt-32 pb-20 sm:px-8">
          <p className="mb-4 text-sm tracking-[0.3em] text-gold uppercase">{t.hero.eyebrow}</p>
          <h1
            id="hero-title"
            className="font-display max-w-4xl text-5xl leading-[1.05] font-medium sm:text-7xl"
          >
            {companyName}
          </h1>
          {settings?.tagline && (
            <p className="mt-6 max-w-2xl text-lg text-mist sm:text-xl">{settings.tagline}</p>
          )}
          <div className="mt-10 flex flex-wrap gap-4">
            <ButtonLink href={`/${locale}#contact`}>{t.nav.bookNow}</ButtonLink>
            <ButtonLink href={`/${locale}#services`} variant="outline">
              {t.hero.ourServices}
            </ButtonLink>
          </div>
        </div>
      </section>

      {settings?.introduction && (
        <section aria-label={t.about.label} className="bg-charcoal">
          <div className="mx-auto max-w-4xl px-4 py-20 text-center sm:px-8">
            <Sparkles aria-hidden="true" className="mx-auto mb-6 size-6 text-gold" />
            <p className="font-display text-2xl leading-relaxed sm:text-3xl">
              {settings.introduction}
            </p>
          </div>
        </section>
      )}

      <section id="services" aria-labelledby="services-title" className="scroll-mt-20">
        <div className="mx-auto max-w-7xl px-4 py-24 sm:px-8">
          <h2 id="services-title" className="font-display text-4xl sm:text-5xl">
            {t.services.title}
          </h2>
          {services.length === 0 ? (
            <p className="mt-6 text-mist">{t.services.empty}</p>
          ) : (
            <ul className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {services.map((service) => {
                const image = asMedia(service.image)
                return (
                  <li
                    key={service.id}
                    className="group overflow-hidden rounded-2xl border border-ivory/10 bg-charcoal transition-colors hover:border-gold/50"
                  >
                    {image?.url ? (
                      <div className="relative aspect-[4/3]">
                        <Image
                          src={image.sizes?.card?.url ?? image.url}
                          alt={image.alt}
                          fill
                          sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
                          className="object-cover transition-transform duration-500 group-hover:scale-105"
                        />
                      </div>
                    ) : (
                      <div className="flex aspect-[4/3] items-center justify-center bg-graphite">
                        <Film aria-hidden="true" className="size-10 text-gold/60" />
                      </div>
                    )}
                    <div className="p-6">
                      <h3 className="font-display text-2xl">{service.title}</h3>
                      <p className="mt-3 text-sm leading-relaxed text-mist">{service.summary}</p>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </section>

      <section
        id="process"
        aria-labelledby="process-title"
        className="scroll-mt-20 border-y border-ivory/10 bg-charcoal"
      >
        <div className="mx-auto max-w-7xl px-4 py-24 sm:px-8">
          <h2 id="process-title" className="font-display text-4xl sm:text-5xl">
            {t.process.title}
          </h2>
          <ol className="mt-12 grid gap-8 md:grid-cols-5">
            {t.process.steps.map((step, index) => (
              <li key={step.title}>
                <span className="font-display text-4xl text-gold">0{index + 1}</span>
                <h3 className="mt-3 text-lg font-medium">{step.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-mist">{step.text}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section id="contact" aria-labelledby="contact-title" className="scroll-mt-20">
        <div className="mx-auto max-w-7xl px-4 py-24 sm:px-8">
          <Clapperboard aria-hidden="true" className="mb-6 size-8 text-gold" />
          <h2 id="contact-title" className="font-display text-4xl sm:text-5xl">
            {t.contact.title}
          </h2>
          <p className="mt-4 max-w-2xl text-mist">{t.contact.text}</p>
          <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {contact.email && (
              <ContactItem icon={<Mail className="size-5" />} href={`mailto:${contact.email}`}>
                {contact.email}
              </ContactItem>
            )}
            {contact.phone && (
              <ContactItem
                icon={<Phone className="size-5" />}
                href={`tel:${contact.phone.replace(/[^+\d]/g, '')}`}
              >
                {contact.phone}
              </ContactItem>
            )}
            {contact.whatsapp && (
              <ContactItem
                icon={<MessageCircle className="size-5" />}
                href={`https://wa.me/${contact.whatsapp}`}
              >
                {t.contact.whatsapp}
              </ContactItem>
            )}
            {contact.address && (
              <ContactItem icon={<MapPin className="size-5" />}>{contact.address}</ContactItem>
            )}
          </ul>
          <div className="mt-16 max-w-3xl">
            <h3 className="font-display text-3xl">{t.inquiry.title}</h3>
            <p className="mt-2 mb-8 text-mist">{t.inquiry.intro}</p>
            <InquiryForm locale={locale} formToken={issueFormToken(tenant.id)} t={t.inquiry} />
          </div>
        </div>
      </section>
    </>
  )
}

function ContactItem({
  icon,
  href,
  children,
}: {
  icon: React.ReactNode
  href?: string
  children: React.ReactNode
}) {
  const content = (
    <>
      <span aria-hidden="true" className="text-gold">
        {icon}
      </span>
      <span className="break-words whitespace-pre-line">{children}</span>
    </>
  )
  const className =
    'flex h-full items-start gap-3 rounded-2xl border border-ivory/10 bg-charcoal p-5 text-sm'
  return (
    <li>
      {href ? (
        <a
          href={href}
          className={`${className} transition-colors hover:border-gold/50`}
          {...(href.startsWith('http') ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
        >
          {content}
        </a>
      ) : (
        <div className={className}>{content}</div>
      )}
    </li>
  )
}
