import type { NaranjaXPaymentSnapshot } from './naranja-x-gateway'

export type NaranjaXAttemptStatus =
  | 'PENDING'
  | 'APPROVED'
  | 'REJECTED'
  | 'CANCELLED'
  | 'REFUNDED'
  | 'PARTIALLY_REFUNDED'
  | 'UNKNOWN'

export interface NaranjaXPaymentExpectation {
  providerPaymentId: string
  orderReference: string
  amountArs: number
  currencyCode: string
}

export type NaranjaXReconciliation =
  | { valid: true; status: NaranjaXAttemptStatus; refundedAmountArs: number }
  | { valid: false; status: 'UNKNOWN'; refundedAmountArs: 0; reason: string }

/**
 * Validates a normalized, server-to-server provider snapshot against the stored
 * attempt and current order. This function does not trust browser return data.
 */
export function reconcileNaranjaXPayment(
  snapshot: NaranjaXPaymentSnapshot,
  expected: NaranjaXPaymentExpectation,
): NaranjaXReconciliation {
  if (!snapshot.providerPaymentId || snapshot.providerPaymentId !== expected.providerPaymentId) {
    return invalid('El identificador del pago no coincide con el intento almacenado.')
  }
  if (!snapshot.orderReference || snapshot.orderReference !== expected.orderReference) {
    return invalid('La referencia del proveedor no coincide con el pedido.')
  }
  if (!Number.isSafeInteger(expected.amountArs) || expected.amountArs <= 0
    || !Number.isSafeInteger(snapshot.amountArs) || snapshot.amountArs !== expected.amountArs) {
    return invalid('El importe del proveedor no coincide con el pedido.')
  }
  if (expected.currencyCode !== 'ARS' || snapshot.currency !== 'ARS') {
    return invalid('La moneda del pago no es ARS.')
  }
  if (!Number.isSafeInteger(snapshot.refundedAmountArs)
    || snapshot.refundedAmountArs < 0
    || snapshot.refundedAmountArs > expected.amountArs) {
    return invalid('El importe reintegrado informado no es válido.')
  }

  switch (snapshot.status) {
    case 'PENDING':
    case 'REJECTED':
    case 'CANCELLED':
    case 'UNKNOWN':
      if (snapshot.refundedAmountArs !== 0) return invalid('El estado informado no admite importes reintegrados.')
      return { valid: true, status: snapshot.status, refundedAmountArs: 0 }
    case 'APPROVED':
      if (snapshot.refundedAmountArs !== 0) return invalid('Un pago aprobado no puede informar reintegros.')
      return { valid: true, status: 'APPROVED', refundedAmountArs: 0 }
    case 'PARTIALLY_REFUNDED':
      if (snapshot.refundedAmountArs <= 0 || snapshot.refundedAmountArs >= expected.amountArs) {
        return invalid('El reintegro parcial debe ser mayor a cero y menor al importe pagado.')
      }
      return { valid: true, status: 'PARTIALLY_REFUNDED', refundedAmountArs: snapshot.refundedAmountArs }
    case 'REFUNDED':
      if (snapshot.refundedAmountArs !== expected.amountArs) {
        return invalid('El reintegro total debe coincidir con el importe pagado.')
      }
      return { valid: true, status: 'REFUNDED', refundedAmountArs: snapshot.refundedAmountArs }
    default:
      return invalid('El proveedor informó un estado no reconocido.')
  }
}

/** Prevent stale notifications from downgrading a terminal or approved attempt. */
export function resolveNaranjaXEffectiveStatus(
  current: NaranjaXAttemptStatus,
  incoming: NaranjaXAttemptStatus,
): NaranjaXAttemptStatus {
  if (current === 'REFUNDED') return 'REFUNDED'
  if (current === 'PARTIALLY_REFUNDED' && incoming !== 'REFUNDED') return 'PARTIALLY_REFUNDED'
  if (current === 'APPROVED' && !['PARTIALLY_REFUNDED', 'REFUNDED'].includes(incoming)) return 'APPROVED'
  if (['REJECTED', 'CANCELLED'].includes(current) && ['PENDING', 'UNKNOWN'].includes(incoming)) return current
  return incoming
}

function invalid(reason: string): NaranjaXReconciliation {
  return { valid: false, status: 'UNKNOWN', refundedAmountArs: 0, reason }
}
