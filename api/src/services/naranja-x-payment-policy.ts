import { createHmac, timingSafeEqual } from 'node:crypto'

export type NaranjaXPaymentStatus =
  | 'PENDING'
  | 'APPROVED'
  | 'REJECTED'
  | 'CANCELLED'
  | 'REFUNDED'
  | 'PARTIALLY_REFUNDED'
  | 'UNKNOWN'

export type NaranjaXPaymentSnapshot = {
  providerPaymentId: string
  merchantReference: string
  amountArs: number
  currencyCode: string
  status: NaranjaXPaymentStatus
}

export type NaranjaXOrderContext = {
  orderId: string
  expectedAmountArs: number
  currencyCode: 'ARS'
  orderStatus: 'PENDING' | 'CONFIRMED' | 'PREPARING' | 'SHIPPED' | 'DELIVERED' | 'CANCELLED'
  hasCancellationRequest: boolean
  existingAttemptStatus?: NaranjaXPaymentStatus | null
}

export type NaranjaXReconciliationDecision =
  | { action: 'KEEP_PENDING'; reason: string }
  | { action: 'MARK_APPROVED'; reason: string }
  | { action: 'MARK_REJECTED'; reason: string }
  | { action: 'MARK_CANCELLED'; reason: string }
  | { action: 'MARK_REFUNDED'; reason: string }
  | { action: 'MARK_PARTIALLY_REFUNDED'; reason: string }
  | { action: 'RECONCILE_MANUALLY'; reason: string }
  | { action: 'IGNORE_DUPLICATE'; reason: string }

/**
 * Validates a provider snapshot against the locally persisted order.
 * This is deliberately provider-neutral: external payloads must first be
 * translated into this canonical shape by the eventual Naranja X adapter.
 */
export function reconcileNaranjaXPayment(
  order: NaranjaXOrderContext,
  payment: NaranjaXPaymentSnapshot,
): NaranjaXReconciliationDecision {
  if (!payment.providerPaymentId.trim() || payment.merchantReference !== order.orderId) {
    return { action: 'RECONCILE_MANUALLY', reason: 'La referencia o el identificador externo no coincide.' }
  }
  if (!Number.isSafeInteger(payment.amountArs) || payment.amountArs <= 0 || payment.amountArs !== order.expectedAmountArs) {
    return { action: 'RECONCILE_MANUALLY', reason: 'El importe informado por el proveedor no coincide con el pedido.' }
  }
  if (payment.currencyCode !== order.currencyCode) {
    return { action: 'RECONCILE_MANUALLY', reason: 'La moneda informada por el proveedor no coincide con el pedido.' }
  }

  if (order.existingAttemptStatus === payment.status
    && ['APPROVED', 'REJECTED', 'CANCELLED', 'REFUNDED', 'PARTIALLY_REFUNDED'].includes(payment.status)) {
    return { action: 'IGNORE_DUPLICATE', reason: 'El estado final ya fue aplicado.' }
  }

  if (order.orderStatus === 'CANCELLED' && payment.status === 'APPROVED') {
    return { action: 'RECONCILE_MANUALLY', reason: 'El proveedor aprobó un pago para un pedido cancelado.' }
  }
  if (order.hasCancellationRequest && payment.status === 'APPROVED') {
    return { action: 'RECONCILE_MANUALLY', reason: 'El pedido tiene una solicitud de arrepentimiento activa.' }
  }

  switch (payment.status) {
    case 'PENDING':
    case 'UNKNOWN':
      return { action: 'KEEP_PENDING', reason: 'El proveedor todavía no confirma un estado final.' }
    case 'APPROVED':
      if (!['PENDING', 'CONFIRMED'].includes(order.orderStatus)) {
        return { action: 'RECONCILE_MANUALLY', reason: 'El pedido ya avanzó a un estado incompatible con una nueva aprobación.' }
      }
      return { action: 'MARK_APPROVED', reason: 'Pago confirmado por el proveedor y conciliado con el pedido.' }
    case 'REJECTED':
      return { action: 'MARK_REJECTED', reason: 'El proveedor rechazó el pago.' }
    case 'CANCELLED':
      return { action: 'MARK_CANCELLED', reason: 'El proveedor canceló el intento de pago.' }
    case 'REFUNDED':
      return { action: 'MARK_REFUNDED', reason: 'El proveedor confirmó el reintegro total.' }
    case 'PARTIALLY_REFUNDED':
      return { action: 'MARK_PARTIALLY_REFUNDED', reason: 'El proveedor confirmó un reintegro parcial.' }
  }
}

/**
 * Generic HMAC-SHA256 primitive. The final adapter must apply the exact
 * canonicalization/header format specified for this merchant by Naranja X.
 */
export function verifyNaranjaXHmacSha256(rawBody: Buffer, suppliedHex: string, secret: string): boolean {
  if (!secret || !/^[a-f0-9]{64}$/i.test(suppliedHex)) return false
  const expected = createHmac('sha256', secret).update(rawBody).digest()
  const supplied = Buffer.from(suppliedHex, 'hex')
  return supplied.length === expected.length && timingSafeEqual(expected, supplied)
}

export type NaranjaXProviderConfig = {
  enabled: boolean
  apiBaseUrl?: string
  partnerId?: string
  apiCredential?: string
  webhookSecret?: string
}

/** Safe configuration gate: never returns secrets to callers. */
export function getNaranjaXPublicConfig(config: NaranjaXProviderConfig) {
  const configured = Boolean(
    config.apiBaseUrl
    && config.partnerId
    && config.apiCredential
    && config.webhookSecret,
  )
  return { provider: 'NARANJA_X' as const, enabled: config.enabled && configured }
}
