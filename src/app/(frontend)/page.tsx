import { Clapperboard, Film, Mail, MapPin, MessageCircle, Phone, Sparkles } from 'lucide-react'
import Image from 'next/image'

import { ButtonLink } from '@/components/ButtonLink'
import { getPublishedServices, getSiteSettings } from '@/lib/site'
import type { Media } from '@/payload-types'

const processSteps = [
  { title: 'Consultation', text: 'We listen to your story, your audience and what success looks like.' },
  { title: 'Planning', text: 'Shot lists, schedules, crew and equipment, agreed before the day.' },
  { title: 'Production', text: 'An experienced crew captures every moment that matters.' },
  { title: 'Editing', text: 'Careful selection, retouching, colour grading and sound.' },
  { title: 'Delivery', text: 'Private online galleries and films, ready to share and download.' },
]

const asMedia = (value: unknown): Media | null =>
  value && typeof value === 'object' && 'url' in value ? (value as Media) : null

export default async function HomePage() {
  const [settings, services] = await Promise.all([getSiteSettings(), getPublishedServices()])
  const hero = asMedia(settings.heroImage)
  const contact = settings.contact ?? {}

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
          <p className="mb-4 text-sm tracking-[0.3em] text-gold uppercase">Media production</p>
          <h1
            id="hero-title"
            className="font-display max-w-4xl text-5xl leading-[1.05] font-medium sm:text-7xl"
          >
            {settings.companyName}
          </h1>
          {settings.tagline && (
            <p className="mt-6 max-w-2xl text-lg text-mist sm:text-xl">{settings.tagline}</p>
          )}
          <div className="mt-10 flex flex-wrap gap-4">
            <ButtonLink href="/#contact">Book now</ButtonLink>
            <ButtonLink href="/#services" variant="outline">
              Our services
            </ButtonLink>
          </div>
        </div>
      </section>

      {settings.introduction && (
        <section aria-label="About us" className="bg-charcoal">
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
            Services
          </h2>
          {services.length === 0 ? (
            <p className="mt-6 text-mist">Our service list is being prepared. Please get in touch.</p>
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
            Our creative process
          </h2>
          <ol className="mt-12 grid gap-8 md:grid-cols-5">
            {processSteps.map((step, index) => (
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
            Tell us about your production
          </h2>
          <p className="mt-4 max-w-2xl text-mist">
            Weddings, events, corporate films, live streams and more. Get in touch and we will
            reply with availability and a quote.
          </p>
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
                WhatsApp
              </ContactItem>
            )}
            {contact.address && (
              <ContactItem icon={<MapPin className="size-5" />}>{contact.address}</ContactItem>
            )}
          </ul>
          {!contact.email && !contact.phone && !contact.whatsapp && (
            <p className="mt-6 text-sm text-mist">Contact details will appear here soon.</p>
          )}
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
