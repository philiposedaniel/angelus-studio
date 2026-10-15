import { ValidationError, type CollectionBeforeValidateHook, type CollectionSlug } from 'payload'

/** Slugs only need to be unique within one studio, so two studios can both have /weddings. */
export const uniqueSlugPerTenant =
  (collection: CollectionSlug): CollectionBeforeValidateHook =>
  async ({ data, originalDoc, req }) => {
    const slug = data?.slug ?? originalDoc?.slug
    const tenant = data?.tenant ?? originalDoc?.tenant
    if (!slug || !tenant) return data
    const tenantId = typeof tenant === 'object' ? tenant.id : tenant
    const { docs } = await req.payload.find({
      collection,
      where: {
        and: [
          { slug: { equals: slug } },
          { tenant: { equals: tenantId } },
          ...(originalDoc?.id ? [{ id: { not_equals: originalDoc.id } }] : []),
        ],
      },
      limit: 1,
      depth: 0,
      req,
    })
    if (docs.length > 0) {
      throw new ValidationError({
        collection,
        errors: [{ message: 'This slug is already used by this studio.', path: 'slug' }],
      })
    }
    return data
  }
