import { APIError, type CollectionBeforeLoginHook, type Payload } from 'payload'

import { verifyTotp } from '@/lib/totp'

/**
 * Authenticator sign-in for studio staff. The password is checked first by Payload; after that a
 * user with authenticator sign-in on must send a current code as `totp` in the same sign-in request.
 * Wrong codes are counted on the account itself, because Payload resets its own password counter
 * before the sign-in hooks run.
 */
export const MFA_MAX_FAILED_CODES = 5
export const MFA_LOCK_MS = 15 * 60 * 1000

const SECRET_PATTERN = /^[A-Z2-7]{32}$/

type Stored = {
  mfaSecret?: string | null
  mfaLastCounter?: number | null
  mfaFailedAttempts?: number | null
  mfaLockedUntil?: string | null
}

const loadStored = async (payload: Payload, userId: number | string): Promise<Stored> =>
  (await payload.findByID({ collection: 'users', id: userId, depth: 0, overrideAccess: true })) as Stored

/**
 * Checks a code against the stored secret and records the outcome on the account. A code that is
 * accepted cannot be used again; enough wrong codes lock the code check for a while.
 */
export async function checkStoredCode(
  payload: Payload,
  userId: number | string,
  code: string,
  now = new Date(),
): Promise<'ok' | 'wrong' | 'locked'> {
  const stored = await loadStored(payload, userId)
  if (!stored.mfaSecret) return 'wrong'
  if (stored.mfaLockedUntil && new Date(stored.mfaLockedUntil).getTime() > now.getTime()) return 'locked'

  const matched = verifyTotp(stored.mfaSecret, code, { at: now, lastCounter: stored.mfaLastCounter ?? null })
  if (matched !== null) {
    await payload.update({
      collection: 'users',
      id: userId,
      data: { mfaLastCounter: matched, mfaFailedAttempts: 0, mfaLockedUntil: null },
      overrideAccess: true,
      depth: 0,
    })
    return 'ok'
  }

  const failed = (stored.mfaFailedAttempts ?? 0) + 1
  const lock = failed >= MFA_MAX_FAILED_CODES
  await payload.update({
    collection: 'users',
    id: userId,
    data: {
      mfaFailedAttempts: lock ? 0 : failed,
      mfaLockedUntil: lock ? new Date(now.getTime() + MFA_LOCK_MS).toISOString() : null,
    },
    overrideAccess: true,
    depth: 0,
  })
  return lock ? 'locked' : 'wrong'
}

/** Sign-in hook: once the password is right, a user with authenticator sign-in on needs a current code. */
export const requireMfaCodeAtLogin: CollectionBeforeLoginHook = async ({ req, user }) => {
  if (!user?.mfaEnabled) return user
  const body = req.data as { totp?: unknown } | undefined
  const code = typeof body?.totp === 'string' ? body.totp : ''
  const outcome = await checkStoredCode(req.payload, user.id, code)
  if (outcome === 'locked') {
    throw new APIError('Too many wrong codes. Try again in 15 minutes.', 401)
  }
  if (outcome === 'wrong') {
    throw new APIError('The authenticator code is missing or wrong.', 401)
  }
  return user
}

/** Turns authenticator sign-in on for a user who has just proved they can produce a code from the new secret. */
export async function enableMfa(payload: Payload, userId: number | string, secret: string, code: string, now = new Date()) {
  if (!SECRET_PATTERN.test(secret)) return false
  const matched = verifyTotp(secret, code, { at: now })
  if (matched === null) return false
  await payload.update({
    collection: 'users',
    id: userId,
    data: {
      mfaEnabled: true,
      mfaSecret: secret,
      mfaLastCounter: matched,
      mfaFailedAttempts: 0,
      mfaLockedUntil: null,
    },
    overrideAccess: true,
    depth: 0,
  })
  return true
}

/** Turns authenticator sign-in off, given a current code, so a stolen session alone cannot do it. */
export async function disableMfa(payload: Payload, userId: number | string, code: string, now = new Date()) {
  const outcome = await checkStoredCode(payload, userId, code, now)
  if (outcome !== 'ok') return outcome
  await payload.update({
    collection: 'users',
    id: userId,
    data: { mfaEnabled: false, mfaSecret: null, mfaLastCounter: null },
    overrideAccess: true,
    depth: 0,
  })
  return 'ok' as const
}
