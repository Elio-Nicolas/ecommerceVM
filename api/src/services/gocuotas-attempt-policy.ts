export type GoCuotasAttemptDisposition = 'REUSE_CHECKOUT' | 'BLOCK_RETRY'

/**
 * Only a persisted checkout URL is safe to reuse. CREATING/UNKNOWN (or a
 * malformed PENDING attempt without URL) must never trigger another POST.
 */
export function getGoCuotasAttemptDisposition(attempt: {
  status: string
  checkoutUrl: string | null
}): GoCuotasAttemptDisposition {
  return attempt.status === 'PENDING' && Boolean(attempt.checkoutUrl)
    ? 'REUSE_CHECKOUT'
    : 'BLOCK_RETRY'
}
