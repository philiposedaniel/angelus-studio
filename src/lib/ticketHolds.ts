import type { Registration } from '@/payload-types'

type Holding = Pick<Registration, 'status' | 'holdExpiresAt'>

/** Whether a registration takes places now: confirmed, or waiting for payment with its hold still on. */
export const holdsPlaces = (registration: Holding | null | undefined, now = Date.now()) =>
  registration?.status === 'confirmed' ||
  (registration?.status === 'pending' &&
    Boolean(registration.holdExpiresAt) &&
    new Date(registration.holdExpiresAt!).getTime() > now)
