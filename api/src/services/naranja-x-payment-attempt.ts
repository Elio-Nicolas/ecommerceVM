import type { NaranjaXCheckoutRequest, NaranjaXGateway } from './naranja-x-gateway'

export type NaranjaXAttemptStatus = 'CREATING' | 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED' | 'UNKNOWN' | 'REFUNDED' | 'PARTIALLY_REFUNDED'

export interface NaranjaXOrderForPayment {
  id: string
  code: string
  totalArs: number | null
  status: string
}

export interface NaranjaXAttemptRecord {
  id: string
  orderId: string
  provider: string
  requestKey: string
  amountArs: number
  currencyCode: string
  status: NaranjaXAttemptStatus
  providerOrderId: string | null
  checkoutUrl: string | null
}

export interface NaranjaXAttemptStore {
  findOrder(orderId: string): Promise<NaranjaXOrderForPayment | null>
  findByRequestKey(requestKey: string): Promise<NaranjaXAttemptRecord | null>
  findActiveForOrder(orderId: string): Promise<NaranjaXAttemptRecord | null>
  create(input: { orderId: string; requestKey: string; amountArs: number }): Promise<NaranjaXAttemptRecord>
  update(id: string, input: {
    status: NaranjaXAttemptStatus
    providerOrderId?: string
    checkoutUrl?: string
    responsePayload?: Record<string, string | number>
    lastError?: string | null
  }): Promise<NaranjaXAttemptRecord>
}

export class NaranjaXAttemptError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message)
    this.name = 'NaranjaXAttemptError'
  }
}

/**
 * Creates one durable PaymentAttempt and asks the configured gateway for checkout.
 * The caller must inject an authenticated, official gateway; the simulator is not
 * wired into runtime. Reusing requestKey makes retries safe after ambiguous errors.
 */
export async function startNaranjaXPaymentAttempt(input: {
  orderId: string
  requestKey: string
  returnUrl: string
  webhookUrl: string
}, dependencies: {
  enabled: boolean
  store: NaranjaXAttemptStore
  gateway: NaranjaXGateway
}): Promise<{ attempt: NaranjaXAttemptRecord; checkoutUrl: string }> {
  if (!dependencies.enabled) throw new NaranjaXAttemptError('NARANJA_X_DISABLED', 'Naranja X no está habilitado.')
  if (!input.orderId.trim() || !input.requestKey.trim()) throw new NaranjaXAttemptError('INVALID_INPUT', 'Pedido y clave de idempotencia son obligatorios.')
  if (!isHttpsUrl(input.returnUrl) || !isHttpsUrl(input.webhookUrl)) throw new NaranjaXAttemptError('INVALID_URL', 'Las URLs de retorno y webhook deben usar HTTPS.')

  const order = await dependencies.store.findOrder(input.orderId)
  if (!order) throw new NaranjaXAttemptError('ORDER_NOT_FOUND', 'El pedido no existe.')
  if (order.status === 'CANCELLED') throw new NaranjaXAttemptError('ORDER_CANCELLED', 'No se puede cobrar un pedido cancelado.')
  if (!Number.isSafeInteger(order.totalArs) || (order.totalArs ?? 0) <= 0) {
    throw new NaranjaXAttemptError('ORDER_TOTAL_UNAVAILABLE', 'El pedido todavía no tiene un total cobrable.')
  }

  let attempt = await dependencies.store.findByRequestKey(input.requestKey)
  if (attempt) {
    if (attempt.provider !== 'NARANJA_X' || attempt.orderId !== order.id || attempt.amountArs !== order.totalArs || attempt.currencyCode !== 'ARS') {
      throw new NaranjaXAttemptError('IDEMPOTENCY_CONFLICT', 'La clave ya fue utilizada con otros datos.')
    }
    if (attempt.checkoutUrl && attempt.providerOrderId && attempt.status === 'PENDING') {
      return { attempt, checkoutUrl: attempt.checkoutUrl }
    }
    if (['APPROVED', 'REFUNDED', 'PARTIALLY_REFUNDED', 'REJECTED', 'CANCELLED'].includes(attempt.status)) {
      throw new NaranjaXAttemptError('ATTEMPT_TERMINAL', 'El intento ya alcanzó un estado final.')
    }
  } else {
    const active = await dependencies.store.findActiveForOrder(order.id)
    if (active) throw new NaranjaXAttemptError('ACTIVE_ATTEMPT_EXISTS', 'El pedido ya tiene un intento Naranja X en curso.')
    attempt = await dependencies.store.create({ orderId: order.id, requestKey: input.requestKey, amountArs: order.totalArs })
  }

  try {
    const request: NaranjaXCheckoutRequest = {
      orderId: order.id,
      orderReference: order.code,
      amountArs: order.totalArs,
      currency: 'ARS',
      idempotencyKey: input.requestKey,
      returnUrl: input.returnUrl,
      webhookUrl: input.webhookUrl,
    }
    const checkout = await dependencies.gateway.createCheckout(request)
    if (
      !checkout.providerPaymentId
      || !isHttpsUrl(checkout.checkoutUrl)
      || checkout.status !== 'PENDING'
      || checkout.orderReference !== order.code
      || checkout.amountArs !== order.totalArs
      || checkout.currency !== 'ARS'
    ) {
      throw new NaranjaXAttemptError('PROVIDER_RESPONSE_MISMATCH', 'Naranja X devolvió datos de checkout incompletos o inconsistentes.')
    }
    const updated = await dependencies.store.update(attempt.id, {
      status: 'PENDING',
      providerOrderId: checkout.providerPaymentId,
      checkoutUrl: checkout.checkoutUrl,
      responsePayload: {
        providerPaymentId: checkout.providerPaymentId,
        orderReference: checkout.orderReference,
        amountArs: checkout.amountArs,
        currency: checkout.currency,
        status: checkout.status,
      },
      lastError: null,
    })
    return { attempt: updated, checkoutUrl: checkout.checkoutUrl }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error desconocido al crear el checkout.'
    await dependencies.store.update(attempt.id, { status: 'UNKNOWN', lastError: message.slice(0, 500) })
    throw error
  }
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:'
  } catch {
    return false
  }
}
