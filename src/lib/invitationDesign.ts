import { hasTenantRole, isSuperAdmin } from '@/access/roles'
import type { User } from '@/payload-types'

/** The looks an event's invitation can take. Each one is a set of colours in styles.css. */
export const INVITATION_STYLES = ['classic', 'garden', 'modern'] as const
export type InvitationStyle = (typeof INVITATION_STYLES)[number]

export const INVITATION_STYLE_LABELS: Record<InvitationStyle, string> = {
  classic: 'Classic: black and gold',
  garden: 'Garden: ivory paper and sage green',
  modern: 'Modern: white and black, plain type',
}

export const invitationThemeClass = (style: unknown): string =>
  `invite-theme-${INVITATION_STYLES.includes(style as InvitationStyle) ? style : 'classic'}`

/** Staff who may preview an invitation: whoever may edit the event. */
export const INVITATION_PREVIEW_ROLES = ['admin', 'production-manager', 'editor'] as const

export const canPreviewInvitation = (user: User | null | undefined, tenantId: number) =>
  Boolean(user) && (isSuperAdmin(user) || hasTenantRole(user, tenantId, INVITATION_PREVIEW_ROLES))

export const MAX_SCHEDULE_ITEMS = 12

export const isWebAddress = (value: string | null | undefined) =>
  !value || /^https:\/\/[^\s]+$/.test(value) || 'Use a full address starting with https://'
