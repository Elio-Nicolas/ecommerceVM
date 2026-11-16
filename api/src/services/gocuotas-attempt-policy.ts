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

export type GoCuotasFailureDisposition = 'RELEASE_ATTEMPT' | 'MARK_UNKNOWN'

/** Authentication happens before checkout creation; only failures after the checkout POST starts are ambiguous. */
export function getGoCuotasFailureDisposition(checkoutRequestStarted: boolean): GoCuotasFailureDisposition {
  return checkoutRequestStarted ? 'MARK_UNKNOWN' : 'RELEASE_ATTEMPT'
}
