import { createHash } from 'node:crypto'

/** The longest contract text a studio can attach to a quote. */
export const MAX_CONTRACT_LENGTH = 10000

const MIN_NAME_LENGTH = 2
const MAX_NAME_LENGTH = 120

/** The fingerprint of the exact terms a client signed, so a later edit is detectable. */
export const termsFingerprint = (terms: string) => createHash('sha256').update(terms, 'utf8').digest('hex')

/** Whether the quote carries contract terms that the client must sign before paying. */
export const contractRequired = (contract: { terms?: string | null } | null | undefined) =>
  Boolean(contract?.terms?.trim())

export const contractSigned = (contract: { signedAt?: string | null } | null | undefined) =>
  Boolean(contract?.signedAt)

/**
 * Checks what the client typed to sign. The name is what they wrote as their signature, and the
 * agreement box must be ticked. Returns the trimmed name, or null when the signature is not valid.
 */
export const signatureName = (raw: unknown, agreed: unknown): string | null => {
  if (agreed !== 'on' || typeof raw !== 'string') return null
  const name = raw.trim().replace(/\s+/g, ' ')
  if (name.length < MIN_NAME_LENGTH || name.length > MAX_NAME_LENGTH) return null
  return name
}
