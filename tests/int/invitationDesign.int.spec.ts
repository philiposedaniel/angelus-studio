import { getPayload, type Payload } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { canPreviewInvitation, invitationThemeClass } from '@/lib/invitationDesign'
import config from '@/payload.config'
import type { Event, Tenant, User } from '@/payload-types'

import { ensureTenant } from '../helpers/seedTenant'

const PREFIX = 'int-invdesign-'
const password = 'int-Password-1'

let payload: Payload
let studioA: Tenant
let studioB: Tenant
let editorA: User
let editorB: User
let clientA: User
let eventA: Event

const makeUser = async (name: string, tenant: Tenant, roles: string[]) => {
  const created = await payload.create({
    collection: 'users',
    data: {
      email: `${PREFIX}${name}@angelus.test`,
      password,
      roles: ['user'],
      tenants: [{ tenant: tenant.id, roles: roles as never }],
    },
  })
  return payload.findByID({ collection: 'users', id: created.id, depth: 0 })
}

const cleanup = async () => {
  await payload.delete({ collection: 'events', where: { slug: { like: PREFIX } }, overrideAccess: true })
  await payload.delete({ collection: 'users', where: { email: { like: PREFIX } } })
}

describe('invitation design', () => {
  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    studioA = await ensureTenant(payload, { name: 'Int Studio A', slug: 'int-studio-a' })
    studioB = await ensureTenant(payload, { name: 'Int Studio B', slug: 'int-studio-b' })
    await cleanup()
    editorA = await makeUser('editor-a', studioA, ['editor'])
    editorB = await makeUser('editor-b', studioB, ['editor'])
    clientA = await makeUser('client-a', studioA, ['client'])
    eventA = await payload.create({
      collection: 'events',
      data: {
        tenant: studioA.id,
        title: `${PREFIX}wedding`,
        slug: `${PREFIX}wedding`,
        startsAt: '2027-06-12T15:00:00.000Z',
        timeZone: 'Europe/Lisbon',
        published: false,
      },
      overrideAccess: true,
    })
  })

  afterAll(cleanup)

  it('lets the studio\'s editor design the invitation, in each language', async () => {
    await payload.update({
      collection: 'events',
      id: eventA.id,
      locale: 'en',
      data: {
        invitation: {
          style: 'garden',
          headline: 'Together with their families',
          dressCode: 'Garden formal',
          schedule: [{ time: '16:00', title: 'Ceremony', place: 'Chapel' }],
          mapUrl: 'https://maps.example.com/quinta',
        },
      },
      user: editorA,
      overrideAccess: false,
    })
    const saved = await payload.findByID({ collection: 'events', id: eventA.id, locale: 'en', depth: 0 })
    const schedule = saved.invitation?.schedule ?? []
    await payload.update({
      collection: 'events',
      id: eventA.id,
      locale: 'es',
      data: {
        title: `${PREFIX}boda`,
        invitation: {
          headline: 'Junto a sus familias',
          schedule: schedule.map((item) => ({ ...item, title: 'Ceremonia' })),
        },
      },
      user: editorA,
      overrideAccess: false,
    })
    const en = await payload.findByID({ collection: 'events', id: eventA.id, locale: 'en', depth: 0 })
    const es = await payload.findByID({ collection: 'events', id: eventA.id, locale: 'es', depth: 0 })
    expect(en.invitation?.style).toBe('garden')
    expect(en.invitation?.headline).toBe('Together with their families')
    expect(es.invitation?.headline).toBe('Junto a sus familias')
    expect(en.invitation?.schedule?.[0]?.title).toBe('Ceremony')
    expect(es.invitation?.schedule?.[0]?.title).toBe('Ceremonia')
    expect(es.invitation?.schedule?.[0]?.time).toBe('16:00')
  })

  it('refuses another studio\'s editor and a client', async () => {
    for (const user of [editorB, clientA]) {
      await expect(
        payload.update({
          collection: 'events',
          id: eventA.id,
          data: { invitation: { headline: 'Hacked' } },
          user,
          overrideAccess: false,
        }),
      ).rejects.toThrow()
    }
  })

  it('only accepts https map links, so the invitation never links to a script', async () => {
    for (const mapUrl of ['javascript:alert(1)', 'http://maps.example.com', 'maps.example.com']) {
      await expect(
        payload.update({ collection: 'events', id: eventA.id, data: { invitation: { mapUrl } }, overrideAccess: true }),
      ).rejects.toThrow()
    }
  })

  it('lets only the site\'s own studio staff preview', () => {
    expect(canPreviewInvitation(editorA, studioA.id)).toBe(true)
    expect(canPreviewInvitation(editorA, studioB.id)).toBe(false)
    expect(canPreviewInvitation(clientA, studioA.id)).toBe(false)
    expect(canPreviewInvitation(null, studioA.id)).toBe(false)
  })

  it('falls back to the classic design for anything unknown', () => {
    expect(invitationThemeClass('modern')).toBe('invite-theme-modern')
    expect(invitationThemeClass('"><script>')).toBe('invite-theme-classic')
    expect(invitationThemeClass(undefined)).toBe('invite-theme-classic')
  })
})
