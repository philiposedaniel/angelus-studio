import { Forbidden, type Payload, type PayloadRequest, type Where } from 'payload'

import { isSuperAdmin, tenantIdsWithRole } from '@/access/roles'

/** Documents the user may read; none when the collection is closed to them, as for a user with no studio role. */
async function docsOrNone<T>(read: Promise<{ docs: T[] }>): Promise<T[]> {
  return read.then((result) => result.docs).catch((error: unknown) => {
    if (error instanceof Forbidden) return []
    throw error
  })
}

/** Who sees a production's client: the studio's production staff, as on the project's internal fields. */
const PRODUCTION_STAFF_ROLES = ['admin', 'production-manager'] as const

export type ClientSummary = {
  quotes: { id: number; title: string; status: string; totalAmount: number; currency: string }[]
  productions: { id: number; title: string; status: string; shootDate: string | null }[]
}

/**
 * The quotes and productions of one client, as far as the signed-in staff member may read them. Access
 * rules apply to the staff member's own request, so a studio's staff never see another studio's records.
 */
export async function clientSummary(
  payload: Payload,
  req: PayloadRequest,
  client: { id: number | string; email: string },
): Promise<ClientSummary> {
  // A project's client field can only be read by production staff, and a field-level rule cannot filter a
  // query, so the production query is limited here to the studios where the user is production staff.
  const staffStudios = isSuperAdmin(req.user) ? null : tenantIdsWithRole(req.user, PRODUCTION_STAFF_ROLES)
  const productionWhere: Where = staffStudios
    ? { and: [{ clientUser: { equals: client.id } }, { tenant: { in: staffStudios } }] }
    : { clientUser: { equals: client.id } }

  const [quoteDocs, projectDocs] = await Promise.all([
    docsOrNone(payload.find({
      collection: 'quotes',
      where: { clientEmail: { equals: client.email } },
      sort: '-createdAt',
      limit: 25,
      depth: 0,
      user: req.user,
      overrideAccess: false,
    })),
    staffStudios?.length === 0
      ? []
      : docsOrNone(
          payload.find({
            collection: 'projects',
            where: productionWhere,
            sort: '-shootDate',
            limit: 25,
            depth: 0,
            overrideAccess: true,
          }),
        ),
  ])
  return {
    quotes: quoteDocs.map((quote) => ({
      id: quote.id,
      title: quote.title,
      status: quote.status,
      totalAmount: quote.totalAmount ?? 0,
      currency: quote.currency,
    })),
    productions: projectDocs.map((project) => ({
      id: project.id,
      title: project.title,
      status: project.status,
      shootDate: project.shootDate ?? null,
    })),
  }
}
