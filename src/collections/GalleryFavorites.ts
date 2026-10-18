import { APIError, type Access, type CollectionConfig, type Where } from 'payload'

import { GALLERY_STAFF_ROLES } from '@/access/galleries'
import { isSuperAdmin, tenantIdsWithRole } from '@/access/roles'
import { quotaReached, selectionLockedFor } from '@/lib/selections'

/** Clients see and remove their own favorites; gallery staff see their studio's. */
export const ownOrStaff: Access = ({ req: { user } }) => {
  if (!user) return false
  if (isSuperAdmin(user)) return true
  const own: Where = { user: { equals: user.id } }
  const staffTenants = tenantIdsWithRole(user, GALLERY_STAFF_ROLES)
  return staffTenants.length ? { or: [own, { tenant: { in: staffTenants } }] } : own
}

const own: Access = ({ req: { user } }) => (user ? { user: { equals: user.id } } : false)

/** A photo a client has marked as a favorite, e.g. to pick photos for an album. */
export const GalleryFavorites: CollectionConfig = {
  slug: 'gallery-favorites',
  labels: { singular: 'Favorite', plural: 'Favorites' },
  admin: {
    defaultColumns: ['photo', 'user', 'createdAt'],
    group: 'Client delivery',
  },
  access: {
    read: ownOrStaff,
    // Anyone signed in may try; the hook below only allows photos they can see.
    create: ({ req: { user } }) => Boolean(user),
    update: () => false,
    delete: own,
  },
  hooks: {
    beforeValidate: [
      async ({ data, operation, req }) => {
        if (operation !== 'create' || !data) return data
        if (!req.user) throw new APIError('Sign in to save favorites.', 401)
        const photoId = typeof data.photo === 'object' ? data.photo?.id : data.photo
        if (!photoId) throw new APIError('Choose a photo.', 400)

        // Favorites always belong to the person saving them, and only for photos they can see.
        const photo = await req.payload
          .findByID({
            collection: 'gallery-photos',
            id: photoId,
            depth: 0,
            req,
            user: req.user,
            overrideAccess: false,
          })
          .catch(() => null)
        if (!photo) throw new APIError('Photo not found.', 404)

        const existing = await req.payload.count({
          collection: 'gallery-favorites',
          where: { and: [{ user: { equals: req.user.id } }, { photo: { equals: photoId } }] },
          req,
        })
        if (existing.totalDocs > 0) throw new APIError('Already a favorite.', 409)

        const galleryId = typeof photo.gallery === 'object' ? photo.gallery.id : photo.gallery
        if (await selectionLockedFor(req.payload, req.user.id, galleryId)) {
          throw new APIError('This selection is locked while the studio reviews it.', 409)
        }
        const gallery = await req.payload
          .findByID({ collection: 'galleries', id: galleryId, depth: 0, overrideAccess: true, req })
          .catch(() => null)
        const selected = await req.payload.count({
          collection: 'gallery-favorites',
          where: { and: [{ user: { equals: req.user.id } }, { gallery: { equals: galleryId } }] },
          req,
        })
        if (quotaReached(selected.totalDocs, gallery?.selectionLimit)) {
          throw new APIError(`This gallery allows ${gallery?.selectionLimit} selected photos.`, 409)
        }

        data.user = req.user.id
        data.gallery = typeof photo.gallery === 'object' ? photo.gallery.id : photo.gallery
        data.tenant = typeof photo.tenant === 'object' ? photo.tenant?.id : photo.tenant
        return data
      },
    ],
    // Only the client's own removal is refused by a lock; cleanup by the server (a deleted
    // gallery or user) is not the client's request and is never blocked.
    beforeDelete: [
      async ({ id, req }) => {
        if (!req.user) return
        const favorite = await req.payload
          .findByID({ collection: 'gallery-favorites', id, depth: 0, overrideAccess: true })
          .catch(() => null)
        if (!favorite) return
        const ownerId = typeof favorite.user === 'object' ? favorite.user.id : favorite.user
        const galleryId = typeof favorite.gallery === 'object' ? favorite.gallery.id : favorite.gallery
        if (ownerId === req.user.id && (await selectionLockedFor(req.payload, ownerId, galleryId))) {
          throw new APIError('This selection is locked while the studio reviews it.', 409)
        }
      },
    ],
  },
  fields: [
    { name: 'user', type: 'relationship', relationTo: 'users', required: true, index: true },
    {
      name: 'photo',
      type: 'relationship',
      relationTo: 'gallery-photos',
      required: true,
      index: true,
    },
    { name: 'gallery', type: 'relationship', relationTo: 'galleries', required: true, index: true },
  ],
}
