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
    const checkout: unknown = this.codec.parseCreateCheckoutResponse(payload, input)

    if (!isRecord(checkout)
      || !isNonEmptyString(checkout.providerPaymentId)
      || !isAbsoluteHttpsUrl(checkout.checkoutUrl)
      || checkout.orderReference !== input.orderReference
      || checkout.amountArs !== input.amountArs
      || checkout.currency !== input.currency
      || !isPaymentStatus(checkout.status)) {
      throw new NaranjaXGatewayProtocolError('La respuesta normalizada de checkout no coincide con el pedido.')
    }
    return checkout as unknown as NaranjaXCheckout
  }

  async getPayment(providerPaymentId: string): Promise<NaranjaXPaymentSnapshot> {
    if (!providerPaymentId.trim()) {
      throw new NaranjaXGatewayProtocolError('El identificador del pago es obligatorio.')
    }

    const request = this.codec.buildGetPaymentRequest(providerPaymentId)
    const payload = await this.http.request<unknown>(request)
    const snapshot: unknown = this.codec.parseGetPaymentResponse(payload, providerPaymentId)

    if (!isRecord(snapshot)
      || snapshot.providerPaymentId !== providerPaymentId
      || !isNonEmptyString(snapshot.orderReference)
      || !Number.isSafeInteger(snapshot.amountArs)
      || (snapshot.amountArs as number) <= 0
      || snapshot.currency !== 'ARS'
      || !isPaymentStatus(snapshot.status)
      || !Number.isSafeInteger(snapshot.refundedAmountArs)
      || (snapshot.refundedAmountArs as number) < 0
      || (snapshot.refundedAmountArs as number) > (snapshot.amountArs as number)) {
      throw new NaranjaXGatewayProtocolError('La respuesta normalizada de consulta de pago no es válida.')
    }

    const normalized = snapshot as unknown as NaranjaXPaymentSnapshot
    if (normalized.status === 'REFUNDED' && normalized.refundedAmountArs !== normalized.amountArs) {
      throw new NaranjaXGatewayProtocolError('El reintegro total no coincide con el importe pagado.')
    }
    if (normalized.status === 'PARTIALLY_REFUNDED'
      && (normalized.refundedAmountArs <= 0 || normalized.refundedAmountArs >= normalized.amountArs)) {
      throw new NaranjaXGatewayProtocolError('El reintegro parcial informado no es válido.')
    }
    if (!['REFUNDED', 'PARTIALLY_REFUNDED'].includes(normalized.status) && normalized.refundedAmountArs !== 0) {
      throw new NaranjaXGatewayProtocolError('El estado informado no admite importes reintegrados.')
    }

    return normalized
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isAbsoluteHttpsUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && Boolean(url.hostname)
  } catch {
    return false
  }
}

function isPaymentStatus(value: unknown): value is NaranjaXPaymentSnapshot['status'] {
  return typeof value === 'string'
    && ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'REFUNDED', 'PARTIALLY_REFUNDED', 'UNKNOWN'].includes(value)
}
