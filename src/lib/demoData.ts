import { randomBytes } from 'node:crypto'

import type { Payload } from 'payload'
import sharp from 'sharp'

import type { Tenant, User } from '@/payload-types'
import type { VendorCategory } from '@/lib/vendors'

/** Thrown when demo data would be mixed into a database that already has real people in it. */
export class DemoDataRefused extends Error {}

export type DemoResult = {
  created: boolean
  tenant: Tenant
  admin: { email: string; password?: string }
  client: { email: string; password?: string }
  links: { label: string; path: string }[]
}

const DAY = 86_400_000

/** A whole hour some days from now, in UTC (Lisbon time for most of the year), so demo times look planned. */
const at = (days: number, hour: number) => {
  const date = new Date(Date.now() + days * DAY)
  date.setUTCHours(hour, 0, 0, 0)
  return date.toISOString()
}

/** Demo sign-ins live on a reserved domain, so they can never be a real person's address. */
export const demoEmail = (role: 'admin' | 'client', tenantSlug: string) =>
  `${role}@${tenantSlug}.demo.test`
const isDemoEmail = (email: string) => email.endsWith('.demo.test')

/** A generated landscape photo, so no binary files ship in the repository. */
async function demoPhoto(title: string, hue: number) {
  const w = 2400
  const h = 1600
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="hsl(${hue},55%,62%)"/><stop offset="1" stop-color="hsl(${(hue + 50) % 360},45%,28%)"/>
    </linearGradient></defs>
    <rect width="100%" height="100%" fill="url(#g)"/>
    <circle cx="${w * 0.7}" cy="${h * 0.35}" r="260" fill="hsla(${(hue + 180) % 360},70%,85%,0.35)"/>
    <text x="120" y="${h - 140}" font-family="sans-serif" font-size="120" fill="white" opacity="0.85">${title}</text>
  </svg>`
  const data = await sharp(Buffer.from(svg)).jpeg({ quality: 85 }).toBuffer()
  const name = `demo-${title.toLowerCase().replace(/\W+/g, '-')}.jpg`
  return { data, mimetype: 'image/jpeg', name, size: data.length }
}

/**
 * Fills a studio with a small, connected set of demo records for a preview server: a studio
 * administrator and a client, a delivered gallery with a share link, a quote with a contract, a
 * production, a private wedding with an invitation and guests, and a public ticketed event.
 *
 * Refuses a database that already holds anyone other than demo accounts, because the demo
 * administrator's password is printed in the clear. Running it again changes nothing.
 */
export async function seedDemoData(
  payload: Payload,
  {
    tenantSlug = 'angelus',
    allowExistingUsers = false,
  }: { tenantSlug?: string; allowExistingUsers?: boolean } = {},
): Promise<DemoResult> {
  if (!allowExistingUsers) {
    const users = await payload.find({
      collection: 'users',
      pagination: false,
      depth: 0,
      overrideAccess: true,
    })
    if (users.docs.some((u) => !isDemoEmail(u.email))) {
      throw new DemoDataRefused(
        'This database already has real accounts. Demo data is only for an empty preview database.',
      )
    }
  }

  const found = await payload.find({
    collection: 'tenants',
    where: { slug: { equals: tenantSlug } },
    limit: 1,
  })
  const tenant =
    found.docs[0] ??
    (await payload.create({
      collection: 'tenants',
      data: {
        name: 'Angelus Media Productions',
        slug: tenantSlug,
        languages: ['en', 'es'],
        defaultLocale: 'en',
      },
    }))
  const settings = await payload.find({
    collection: 'site-settings',
    where: { tenant: { equals: tenant.id } },
    limit: 1,
  })
  if (settings.totalDocs === 0) {
    await payload.create({
      collection: 'site-settings',
      data: {
        tenant: tenant.id,
        companyName: tenant.name,
        tagline: 'Cinematic photography, film and live production.',
      },
    })
  }

  const services = await payload.count({
    collection: 'services',
    where: { tenant: { equals: tenant.id } },
  })
  if (services.totalDocs === 0) {
    const demoServices = [
      [
        'Wedding photography',
        'demo-weddings',
        'The whole day, from getting ready to the last dance, delivered in a private gallery.',
      ],
      ['Films', 'demo-films', 'Highlight films and full-length edits, graded and scored.'],
      [
        'Live events',
        'demo-live-events',
        'Multi-camera coverage, livestreams and sound for conferences and concerts.',
      ],
    ] as const
    for (const [order, [title, slug, summary]] of demoServices.entries()) {
      await payload.create({
        collection: 'services',
        data: { tenant: tenant.id, title, slug, summary, order, published: true },
      })
    }
  }

  const adminEmail = demoEmail('admin', tenantSlug)
  const clientEmail = demoEmail('client', tenantSlug)
  const already = await payload.find({
    collection: 'users',
    where: { email: { equals: adminEmail } },
    limit: 1,
  })
  if (already.totalDocs > 0) {
    return {
      created: false,
      tenant,
      admin: { email: adminEmail },
      client: { email: clientEmail },
      links: [],
    }
  }

  const password = randomBytes(9).toString('base64url')
  const makeUser = (email: string, name: string, roles: string[]): Promise<User> =>
    payload.create({
      collection: 'users',
      data: {
        email,
        name,
        password,
        roles: ['user'],
        tenants: [{ tenant: tenant.id, roles: roles as never }],
      },
    })
  const admin = await makeUser(adminEmail, 'Demo administrator', ['admin'])
  const client = await makeUser(clientEmail, 'Ana Ferreira', ['client', 'event-organizer'])

  const gallery = await payload.create({
    collection: 'galleries',
    data: {
      tenant: tenant.id,
      title: 'Ana and João wedding',
      slug: 'demo-ana-joao-wedding',
      description: 'Highlights from the ceremony and the evening.',
      status: 'published',
      clients: [client.id],
      allowDownloads: true,
      // Clients choose up to five photos by marking favorites, then submit them.
      selectionLimit: 5,
      shareEnabled: true,
    },
  })
  const shots = [
    'First look',
    'The vows',
    'Ring exchange',
    'Golden hour',
    'First dance',
    'Family portrait',
    'Cake',
    'Sparkler exit',
  ]
  for (const [i, title] of shots.entries()) {
    await payload.create({
      collection: 'gallery-photos',
      data: { gallery: gallery.id },
      file: await demoPhoto(title, (i * 41) % 360),
    })
  }
  const shareToken = (await payload.findByID({ collection: 'galleries', id: gallery.id, depth: 0 }))
    .shareToken

  const quote = await payload.create({
    collection: 'quotes',
    data: {
      tenant: tenant.id,
      title: 'Wedding photography and film',
      clientName: 'Ana Ferreira',
      clientEmail,
      currency: 'eur',
      lineItems: [
        { description: 'Wedding photography, full day', quantity: 1, unitAmount: 180000 },
        { description: 'Highlight film, 5 minutes', quantity: 1, unitAmount: 120000 },
        { description: 'Extra hour', quantity: 2, unitAmount: 15000 },
      ],
      depositPercent: 30,
      // The 2,310.00 balance after the deposit is paid in two dated installments.
      paymentSchedule: [
        { dueDate: at(14, 0), amount: 115500 },
        { dueDate: at(35, 0), amount: 115500 },
      ],
      status: 'sent',
      contract: {
        terms:
          'The photographer arrives at 10:00 and stays until the first dance. Delivery within six weeks.',
      },
    },
    overrideAccess: true,
  })

  const project = await payload.create({
    collection: 'projects',
    data: {
      tenant: tenant.id,
      title: 'Ana and João wedding',
      clientName: 'Ana Ferreira',
      clientEmail,
      clientUser: client.id,
      status: 'confirmed',
      shootDate: at(40, 15),
      location: 'Quinta da Regaleira, Sintra',
      crew: [{ user: admin.id, role: 'Lead photographer' }],
      tasks: [
        {
          title: 'Scout the venue',
          dueDate: new Date(Date.now() + 10 * DAY).toISOString(),
          done: true,
        },
        {
          title: 'Confirm the shot list with the couple',
          dueDate: new Date(Date.now() + 20 * DAY).toISOString(),
        },
      ],
      callSheet: {
        meetingPoint: 'Main gate, Quinta da Regaleira',
        notes: 'Bring the second body and the gimbal.',
        schedule: [
          { time: '10:00', item: 'Getting ready', location: 'Bridal suite' },
          { time: '16:00', item: 'Ceremony', location: 'The chapel' },
        ],
      },
    },
    overrideAccess: true,
  })

  // More productions, so the public availability page has booked days in each month it shows. The one
  // still being planned holds no day there.
  for (const [title, clientName, status, days] of [
    ['Lisbon design week, event coverage', 'Lisbon Design Week', 'confirmed', 12],
    ['Costa family portraits', 'Marta Costa', 'planning', 26],
    ['Nunes and Rocha wedding', 'Inês Nunes', 'confirmed', 58],
  ] as const) {
    await payload.create({
      collection: 'projects',
      data: {
        tenant: tenant.id,
        title,
        clientName,
        status,
        shootDate: at(days, 10),
        crew: [{ user: admin.id, role: 'Photographer' }],
      },
      overrideAccess: true,
    })
  }

  const wedding = await payload.create({
    collection: 'events',
    data: {
      tenant: tenant.id,
      title: 'Ana and João',
      slug: 'demo-ana-joao',
      startsAt: at(40, 15),
      timeZone: 'Europe/Lisbon',
      location: 'Quinta da Regaleira, Sintra',
      published: true,
      listed: false,
      gallery: gallery.id,
      organizers: [client.id],
      invitation: {
        style: 'garden',
        headline: 'Together with their families',
        message: 'We would love you to celebrate with us.',
        schedule: [
          { time: '16:00', title: 'Ceremony', place: 'The chapel' },
          { time: '19:00', title: 'Dinner and dancing', place: 'The gardens' },
        ],
        dressCode: 'Garden formal',
      },
    },
  })
  const guests = [
    { name: 'Maria Silva', partySize: 2, rsvpStatus: 'attending' },
    { name: 'Rui Costa', partySize: 1, rsvpStatus: 'pending' },
    { name: 'Inês Santos', partySize: 3, rsvpStatus: 'attending' },
    { name: 'Pedro Almeida', partySize: 2, rsvpStatus: 'declined' },
    { name: 'Sofia Martins', partySize: 1, rsvpStatus: 'pending' },
  ] as const
  let inviteToken = ''
  const attending: { id: number; partySize: number }[] = []
  for (const g of guests) {
    const guest = await payload.create({
      collection: 'event-guests',
      data: {
        event: wedding.id,
        language: 'en',
        ...g,
        attendingCount: g.rsvpStatus === 'attending' ? g.partySize : 0,
      },
    })
    if (g.rsvpStatus === 'pending' && !inviteToken) inviteToken = guest.inviteToken ?? ''
    if (g.rsvpStatus === 'attending') attending.push({ id: guest.id, partySize: g.partySize })
  }

  // Seating: two tables, with the guests who are coming at the first one.
  const [familyTable] = await Promise.all(
    (
      [
        ['Family', 8, 1],
        ['Friends', 10, 2],
      ] as const
    ).map(([name, capacity, sortOrder]) =>
      payload.create({
        collection: 'event-tables',
        data: { event: wedding.id, name, capacity, sortOrder },
      }),
    ),
  )
  for (const guest of attending) {
    await payload.update({
      collection: 'event-guests',
      id: guest.id,
      data: { table: familyTable.id },
    })
  }

  // Vendors booked for the wedding: one confirmed and part paid, one still a proposal.
  const vendor = (name: string, category: VendorCategory, contactName: string) =>
    payload.create({
      collection: 'vendors',
      data: {
        tenant: tenant.id,
        name,
        category,
        contactName,
        email: `${category}@vendors.demo.test`,
      },
    })
  const florist = await vendor('Flores do Jardim', 'florist', 'Marta Lopes')
  const caterer = await vendor('Mesa Lisboa', 'catering', 'Tiago Reis')
  const floristBooking = await payload.create({
    collection: 'event-vendors',
    data: {
      event: wedding.id,
      vendor: florist.id,
      role: 'Ceremony and table flowers',
      status: 'confirmed',
      arrivalAt: at(40, 9),
      instructions: 'Unload at the side gate. Power is in the chapel vestry.',
      currency: 'eur',
      amountDue: 120000,
      amountPaid: 40000,
    },
  })
  await payload.create({
    collection: 'event-vendors',
    data: {
      event: wedding.id,
      vendor: caterer.id,
      role: 'Dinner for 120',
      status: 'proposed',
      currency: 'eur',
      amountDue: 960000,
    },
  })

  // Kit for the production: two pieces reserved, one already out of the studio.
  const kit = async (name: string, category: string, serialNumber: string) =>
    payload.create({
      collection: 'equipment',
      data: { tenant: tenant.id, name, category, serialNumber, active: true },
    })
  const camera = await kit('Sony FX3', 'Camera', 'FX3-0142')
  const gimbal = await kit('DJI RS 4 Pro', 'Gimbal', 'RS4-2210')
  await kit('Aputure 600d', 'Light', 'AP6-0087')
  const shootStart = at(40, 8)
  const shootEnd = at(41, 0)
  await payload.create({
    collection: 'equipment-reservations',
    data: {
      tenant: tenant.id,
      equipment: camera.id,
      project: project.id,
      startsAt: shootStart,
      endsAt: shootEnd,
    },
  })
  await payload.create({
    collection: 'equipment-reservations',
    data: {
      tenant: tenant.id,
      equipment: gimbal.id,
      project: project.id,
      // Taken out early for a test shoot at the venue.
      startsAt: at(-1, 9),
      endsAt: shootEnd,
      checkedOutAt: at(-1, 9),
      notes: 'Out for the venue test shoot.',
    },
  })

  const openDay = await payload.create({
    collection: 'events',
    data: {
      tenant: tenant.id,
      title: 'Studio open day',
      slug: 'demo-studio-open-day',
      summary: 'Meet the team, see our work and try the photo booth.',
      startsAt: at(21, 10),
      timeZone: 'Europe/Lisbon',
      location: 'Angelus studio, Lisbon',
      published: true,
      listed: true,
    },
  })
  const ticketType = (
    name: string,
    capacity: number,
    maxPerOrder: number,
    sortOrder: number,
    price: number,
  ) =>
    payload.create({
      collection: 'ticket-types',
      data: { event: openDay.id, name, capacity, maxPerOrder, sortOrder, price, currency: 'eur' },
    })
  await ticketType('General admission', 60, 4, 1, 0)
  const workshop = await ticketType('Lighting workshop', 1, 1, 2, 0)
  // Priced, so it shows its price but is only sold once Stripe is configured.
  await ticketType('Portrait session', 10, 1, 3, 4500)
  await payload.create({
    collection: 'promo-codes',
    data: {
      event: openDay.id,
      code: 'OPENDAY20',
      discountType: 'percent',
      percentOff: 20,
      active: true,
    },
  })
  const ticket = await payload.create({
    collection: 'registrations',
    data: {
      ticketType: workshop.id,
      name: 'Ana Ferreira',
      email: clientEmail,
      quantity: 1,
      status: 'confirmed',
      language: 'en',
    },
  })

  // A ticketed event the client hosts, held four days ago, so her portal shows real ticket sales
  // and door check-ins. Both tickets are free: no payment is ever recorded without Stripe.
  const party = await payload.create({
    collection: 'events',
    data: {
      tenant: tenant.id,
      title: 'Ferreira & Co. summer party',
      slug: 'demo-ferreira-summer-party',
      summary: 'Drinks, dinner and a photo booth for the team and their guests.',
      startsAt: at(-4, 18),
      timeZone: 'Europe/Lisbon',
      location: 'LX Factory, Lisbon',
      published: true,
      listed: false,
      organizers: [client.id],
    },
  })
  const partyTicket = (name: string, capacity: number, sortOrder: number) =>
    payload.create({
      collection: 'ticket-types',
      data: {
        event: party.id,
        name,
        capacity,
        maxPerOrder: 4,
        sortOrder,
        price: 0,
        currency: 'eur',
      },
    })
  const team = await partyTicket('Team', 40, 1)
  const plusOne = await partyTicket('Guest of the team', 20, 2)
  const partyGuests: [typeof team, string, number, number][] = [
    [team, 'Beatriz Lopes', 4, 4],
    [team, 'Carlos Nunes', 4, 3],
    [team, 'Diana Rocha', 3, 3],
    [team, 'Eduardo Pires', 4, 4],
    [team, 'Filipa Sousa', 2, 0],
    [plusOne, 'Gustavo Matos', 2, 2],
    [plusOne, 'Helena Dias', 3, 2],
  ]
  for (const [ticketType, name, quantity, checkedInCount] of partyGuests) {
    await payload.create({
      collection: 'registrations',
      data: {
        ticketType: ticketType.id,
        name,
        email: `${name.split(' ')[0]!.toLowerCase()}@guests.demo.test`,
        quantity,
        status: 'confirmed',
        checkedInCount,
        language: 'en',
      },
    })
  }

  // The workshop's one place is taken, so the next person waits for it.
  const waiting = await payload.create({
    collection: 'waitlist-entries',
    data: {
      ticketType: workshop.id,
      event: openDay.id,
      name: 'Rui Costa',
      email: 'rui@guests.demo.test',
      quantity: 1,
      status: 'waiting',
      language: 'en',
    },
  })

  await payload.create({
    collection: 'inquiries',
    data: {
      tenant: tenant.id,
      name: 'Carla Mendes',
      email: 'carla@guests.demo.test',
      eventType: 'corporate',
      eventDate: new Date(Date.now() + 75 * DAY).toISOString(),
      location: 'Lisbon',
      message:
        'We are planning a product launch for 200 guests and would like photos, a short film and a livestream.',
      locale: 'en',
      status: 'new',
    },
  })

  return {
    created: true,
    tenant,
    admin: { email: adminEmail, password },
    client: { email: clientEmail, password },
    links: [
      { label: 'Public events', path: '/en/events' },
      { label: 'Event with tickets', path: '/en/events/demo-studio-open-day' },
      { label: 'Ticket', path: `/en/tickets/${ticket.ticketToken}` },
      { label: 'Invitation', path: `/en/invite/${inviteToken}` },
      { label: 'Quote and contract', path: `/en/quote/${quote.publicToken}` },
      { label: 'Shared album', path: `/s/${shareToken}` },
      { label: 'Vendor booking', path: `/en/vendor/${floristBooking.vendorToken}` },
      { label: 'Waitlist place', path: `/en/waitlist/${waiting.claimToken}` },
      { label: 'Client portal', path: '/en/portal' },
      { label: 'Studio admin', path: '/admin' },
    ],
  }
}
