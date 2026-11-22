export type NaranjaXPaymentStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED' | 'REFUNDED' | 'PARTIALLY_REFUNDED' | 'UNKNOWN'

export interface NaranjaXCheckoutRequest {
  orderId: string
  orderReference: string
  amountArs: number
  currency: 'ARS'
  idempotencyKey: string
  returnUrl: string
  webhookUrl: string
}

export interface NaranjaXCheckout {
  providerPaymentId: string
  checkoutUrl: string
  status: NaranjaXPaymentStatus
  amountArs: number
  currency: 'ARS'
  orderReference: string
}

export interface NaranjaXPaymentSnapshot {
  providerPaymentId: string
  orderReference: string
  amountArs: number
  currency: 'ARS'
  status: NaranjaXPaymentStatus
  refundedAmountArs: number
}

/**
 * Contract boundary for an eventual Naranja X gateway.
 * Implementations must verify provider-side payment state before returning APPROVED.
 * No endpoint, authentication scheme, or payload is assumed here.
 */
export interface NaranjaXGateway {
  createCheckout(input: NaranjaXCheckoutRequest): Promise<NaranjaXCheckout>
  getPayment(providerPaymentId: string): Promise<NaranjaXPaymentSnapshot>
}

/**
 * In-memory simulator for automated tests and local development only.
 * It deliberately uses the reserved .invalid domain and cannot collect money.
 */
export class NaranjaXSimulator implements NaranjaXGateway {
  private readonly payments = new Map<string, NaranjaXPaymentSnapshot>()
  private readonly idempotency = new Map<string, string>()
  private sequence = 0

  async createCheckout(input: NaranjaXCheckoutRequest): Promise<NaranjaXCheckout> {
    if (!input.orderId.trim() || !input.orderReference.trim()) throw new Error('El pedido y su referencia son obligatorios.')
    if (!Number.isSafeInteger(input.amountArs) || input.amountArs <= 0) throw new Error('El importe debe ser un entero positivo en ARS.')
    if (input.currency !== 'ARS') throw new Error('Naranja X solo admite ARS en este adaptador.')
    if (!input.idempotencyKey.trim()) throw new Error('La clave de idempotencia es obligatoria.')
    if (!isAbsoluteHttpUrl(input.returnUrl) || !isAbsoluteHttpUrl(input.webhookUrl)) throw new Error('Las URLs de retorno y webhook deben ser absolutas.')

    const previousId = this.idempotency.get(input.idempotencyKey)
    if (previousId) {
      const previous = this.payments.get(previousId)!
      if (previous.orderReference !== input.orderReference || previous.amountArs !== input.amountArs) {
        throw new Error('La clave de idempotencia ya fue utilizada con otros datos.')
      }
      return this.toCheckout(previous)
    }

    this.sequence += 1
    const providerPaymentId = 'nx_sim_' + this.sequence
    const snapshot: NaranjaXPaymentSnapshot = {
      providerPaymentId,
      orderReference: input.orderReference,
      amountArs: input.amountArs,
      currency: 'ARS',
      status: 'PENDING',
      refundedAmountArs: 0,
    }
    this.payments.set(providerPaymentId, snapshot)
    this.idempotency.set(input.idempotencyKey, providerPaymentId)
    return this.toCheckout(snapshot)
  }

  async getPayment(providerPaymentId: string): Promise<NaranjaXPaymentSnapshot> {
    const payment = this.payments.get(providerPaymentId)
    if (!payment) throw new Error('El pago simulado no existe.')
    return { ...payment }
  }

  /** Test-only state transition; production adapters must never expose this operation. */
  simulateStatus(providerPaymentId: string, status: NaranjaXPaymentStatus, refundedAmountArs = 0): void {
    const payment = this.payments.get(providerPaymentId)
    if (!payment) throw new Error('El pago simulado no existe.')
    if (!Number.isSafeInteger(refundedAmountArs) || refundedAmountArs < 0 || refundedAmountArs > payment.amountArs) {
      throw new Error('El importe reintegrado no es válido.')
    }
    if (status === 'PARTIALLY_REFUNDED' && (refundedAmountArs <= 0 || refundedAmountArs >= payment.amountArs)) {
      throw new Error('Un reintegro parcial debe ser mayor a cero y menor al pago.')
    }
    if (status === 'REFUNDED' && refundedAmountArs !== payment.amountArs) {
      throw new Error('Un reintegro total debe coincidir con el importe pagado.')
    }
    if (!['PARTIALLY_REFUNDED', 'REFUNDED'].includes(status) && refundedAmountArs !== 0) {
      throw new Error('Solo los estados de reintegro admiten un importe reintegrado.')
    }
    this.payments.set(providerPaymentId, { ...payment, status, refundedAmountArs })
  }

  private toCheckout(payment: NaranjaXPaymentSnapshot): NaranjaXCheckout {
    return {
      providerPaymentId: payment.providerPaymentId,
      checkoutUrl: 'https://naranja-x-simulator.invalid/checkout/' + encodeURIComponent(payment.providerPaymentId),
      status: payment.status,
      amountArs: payment.amountArs,
      currency: payment.currency,
      orderReference: payment.orderReference,
    }
  }
}

function isAbsoluteHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:'
  } catch {
    return false
  }
}
