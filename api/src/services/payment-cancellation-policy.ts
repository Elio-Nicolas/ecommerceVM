export type PaymentStateForCancellation = { provider: string; status: string }

const unresolvedStatuses = new Set(['CREATING', 'PENDING', 'UNKNOWN'])
const paidStatuses = new Set(['APPROVED', 'PARTIALLY_REFUNDED'])

export function getPaymentCancellationBlock(attempts: PaymentStateForCancellation[]): 'PAYMENT_APPROVED' | 'PAYMENT_UNRESOLVED' | null {
  if (attempts.some((attempt) => paidStatuses.has(attempt.status))) return 'PAYMENT_APPROVED'
  if (attempts.some((attempt) => unresolvedStatuses.has(attempt.status))) return 'PAYMENT_UNRESOLVED'
  return null
}

export function hasUnresolvedOnlinePayment(attempts: PaymentStateForCancellation[]): boolean {
  return attempts.some((attempt) => unresolvedStatuses.has(attempt.status))
}
