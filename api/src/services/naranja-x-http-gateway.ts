import type {
  NaranjaXCheckout,
  NaranjaXCheckoutRequest,
  NaranjaXGateway,
  NaranjaXPaymentSnapshot,
} from './naranja-x-gateway'
import { NaranjaXHttpClient, type NaranjaXHttpRequest } from './naranja-x-http-client'

/**
 * Provider-specific protocol boundary.
 *
 * Implement this codec only from the API contract Naranja X confirms for the
 * merchant. It owns endpoint paths, authentication headers, request payloads,
 * response parsing and provider status mapping.
 */
export interface NaranjaXProtocolCodec {
  buildCreateCheckoutRequest(input: NaranjaXCheckoutRequest): NaranjaXHttpRequest
  parseCreateCheckoutResponse(payload: unknown, input: NaranjaXCheckoutRequest): NaranjaXCheckout
  buildGetPaymentRequest(providerPaymentId: string): NaranjaXHttpRequest
  parseGetPaymentResponse(payload: unknown, providerPaymentId: string): NaranjaXPaymentSnapshot
}

export class NaranjaXGatewayProtocolError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NaranjaXGatewayProtocolError'
  }
}

/**
 * Complete internal NaranjaXGateway adapter shell. The injected codec is the
 * only provider-specific piece; this class enforces normalized invariants
 * before any result can enter payment reconciliation.
 */
export class NaranjaXHttpGateway implements NaranjaXGateway {
  constructor(
    private readonly http: NaranjaXHttpClient,
    private readonly codec: NaranjaXProtocolCodec,
  ) {}

  async createCheckout(input: NaranjaXCheckoutRequest): Promise<NaranjaXCheckout> {
    const request = this.codec.buildCreateCheckoutRequest(input)
    const payload = await this.http.request<unknown>(request)
    const checkout = this.codec.parseCreateCheckoutResponse(payload, input)

    if (!checkout.providerPaymentId.trim()
      || !isAbsoluteHttpsUrl(checkout.checkoutUrl)
      || checkout.orderReference !== input.orderReference
      || checkout.amountArs !== input.amountArs
      || checkout.currency !== input.currency
      || !isPaymentStatus(checkout.status)) {
      throw new NaranjaXGatewayProtocolError('La respuesta normalizada de checkout no coincide con el pedido.')
    }
    return checkout
  }

  async getPayment(providerPaymentId: string): Promise<NaranjaXPaymentSnapshot> {
    if (!providerPaymentId.trim()) {
      throw new NaranjaXGatewayProtocolError('El identificador del pago es obligatorio.')
    }

    const request = this.codec.buildGetPaymentRequest(providerPaymentId)
    const payload = await this.http.request<unknown>(request)
    const snapshot = this.codec.parseGetPaymentResponse(payload, providerPaymentId)

    if (snapshot.providerPaymentId !== providerPaymentId
      || !snapshot.orderReference.trim()
      || !Number.isSafeInteger(snapshot.amountArs)
      || snapshot.amountArs <= 0
      || snapshot.currency !== 'ARS'
      || !isPaymentStatus(snapshot.status)
      || !Number.isSafeInteger(snapshot.refundedAmountArs)
      || snapshot.refundedAmountArs < 0
      || snapshot.refundedAmountArs > snapshot.amountArs) {
      throw new NaranjaXGatewayProtocolError('La respuesta normalizada de consulta de pago no es válida.')
    }

    if (snapshot.status === 'REFUNDED' && snapshot.refundedAmountArs !== snapshot.amountArs) {
      throw new NaranjaXGatewayProtocolError('El reintegro total no coincide con el importe pagado.')
    }
    if (snapshot.status === 'PARTIALLY_REFUNDED'
      && (snapshot.refundedAmountArs <= 0 || snapshot.refundedAmountArs >= snapshot.amountArs)) {
      throw new NaranjaXGatewayProtocolError('El reintegro parcial informado no es válido.')
    }
    if (!['REFUNDED', 'PARTIALLY_REFUNDED'].includes(snapshot.status) && snapshot.refundedAmountArs !== 0) {
      throw new NaranjaXGatewayProtocolError('El estado informado no admite importes reintegrados.')
    }

    return snapshot
  }
}

function isAbsoluteHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:'
  } catch {
    return false
  }
}

function isPaymentStatus(value: string): value is NaranjaXPaymentSnapshot['status'] {
  return ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'REFUNDED', 'PARTIALLY_REFUNDED', 'UNKNOWN'].includes(value)
}
