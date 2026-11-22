import assert from 'node:assert/strict'
import test from 'node:test'
import {
  NaranjaXGatewayProtocolError,
  NaranjaXHttpGateway,
  type NaranjaXProtocolCodec,
} from '../src/services/naranja-x-http-gateway'
import { NaranjaXHttpClient } from '../src/services/naranja-x-http-client'
import type {
  NaranjaXCheckout,
  NaranjaXCheckoutRequest,
  NaranjaXPaymentSnapshot,
} from '../src/services/naranja-x-gateway'

const checkoutInput: NaranjaXCheckoutRequest = {
  orderId: 'order-100',
  orderReference: 'EV-100',
  amountArs: 125000,
  currency: 'ARS',
  idempotencyKey: 'idem-order-100',
  returnUrl: 'https://shop.example.test/payment/return',
  webhookUrl: 'https://shop.example.test/api/webhooks/naranja-x',
}

const checkout: NaranjaXCheckout = {
  providerPaymentId: 'nx-payment-100',
  checkoutUrl: 'https://checkout.example.test/session/100',
  status: 'PENDING',
  amountArs: 125000,
  currency: 'ARS',
  orderReference: 'EV-100',
}

const snapshot: NaranjaXPaymentSnapshot = {
  providerPaymentId: 'nx-payment-100',
  orderReference: 'EV-100',
  amountArs: 125000,
  currency: 'ARS',
  status: 'APPROVED',
  refundedAmountArs: 0,
}

function codec(overrides: Partial<NaranjaXProtocolCodec> = {}): NaranjaXProtocolCodec {
  return {
    buildCreateCheckoutRequest: () => ({ method: 'POST', path: '/provider-checkout', body: { amount: 125000 } }),
    parseCreateCheckoutResponse: () => checkout,
    buildGetPaymentRequest: (id) => ({ method: 'GET', path: '/provider-payments/' + encodeURIComponent(id) }),
    parseGetPaymentResponse: () => snapshot,
    ...overrides,
  }
}

function gateway(
  selectedCodec: NaranjaXProtocolCodec = codec(),
  response: unknown = { provider: 'payload' },
) {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  const http = new NaranjaXHttpClient({
    baseUrl: 'https://api.provider.example.test',
    fetchImpl: (async (input, init) => {
      calls.push({ url: String(input), init })
      return new Response(JSON.stringify(response), { status: 200 })
    }) as typeof fetch,
  })
  return { instance: new NaranjaXHttpGateway(http, selectedCodec), calls }
}

test('implements NaranjaXGateway through an injected provider protocol codec', async () => {
  const { instance, calls } = gateway()
  assert.deepEqual(await instance.createCheckout(checkoutInput), checkout)
  assert.deepEqual(await instance.getPayment('nx-payment-100'), snapshot)
  assert.deepEqual(calls.map(call => call.url), [
    'https://api.provider.example.test/provider-checkout',
    'https://api.provider.example.test/provider-payments/nx-payment-100',
  ])
})

test('rejects checkout responses that alter amount, reference, currency or redirect to HTTP', async () => {
  for (const invalid of [
    { ...checkout, amountArs: 1 },
    { ...checkout, orderReference: 'OTHER' },
    { ...checkout, currency: 'USD' as 'ARS' },
    { ...checkout, checkoutUrl: 'http://checkout.example.test/session/100' },
  ]) {
    const { instance } = gateway(codec({ parseCreateCheckoutResponse: () => invalid }))
    await assert.rejects(
      instance.createCheckout(checkoutInput),
      (error: unknown) => error instanceof NaranjaXGatewayProtocolError,
    )
  }
})

test('rejects payment snapshots with mismatched identity or invalid refund totals', async () => {
  for (const invalid of [
    { ...snapshot, providerPaymentId: 'another-payment' },
    { ...snapshot, amountArs: 0 },
    { ...snapshot, refundedAmountArs: 1 },
    { ...snapshot, status: 'REFUNDED' as const, refundedAmountArs: 1 },
    { ...snapshot, status: 'PARTIALLY_REFUNDED' as const, refundedAmountArs: 125000 },
  ]) {
    const { instance } = gateway(codec({ parseGetPaymentResponse: () => invalid }))
    await assert.rejects(
      instance.getPayment('nx-payment-100'),
      (error: unknown) => error instanceof NaranjaXGatewayProtocolError,
    )
  }
})

test('rejects empty provider payment IDs before making a network request', async () => {
  const { instance, calls } = gateway()
  await assert.rejects(
    instance.getPayment(' '),
    (error: unknown) => error instanceof NaranjaXGatewayProtocolError,
  )
  assert.equal(calls.length, 0)
})


test('normalizes null and malformed codec outputs as protocol errors instead of TypeErrors', async () => {
  const malformedCheckouts: unknown[] = [
    null,
    {},
    { ...checkout, providerPaymentId: 42 },
    { ...checkout, checkoutUrl: null },
    { ...checkout, status: 'NOT_A_STATUS' },
  ]
  for (const malformed of malformedCheckouts) {
    const { instance } = gateway(codec({
      parseCreateCheckoutResponse: () => malformed as NaranjaXCheckout,
    }))
    await assert.rejects(
      instance.createCheckout(checkoutInput),
      (error: unknown) => error instanceof NaranjaXGatewayProtocolError,
    )
  }

  const malformedSnapshots: unknown[] = [
    null,
    {},
    { ...snapshot, orderReference: null },
    { ...snapshot, amountArs: '125000' },
    { ...snapshot, refundedAmountArs: null },
    { ...snapshot, status: 'NOT_A_STATUS' },
  ]
  for (const malformed of malformedSnapshots) {
    const { instance } = gateway(codec({
      parseGetPaymentResponse: () => malformed as NaranjaXPaymentSnapshot,
    }))
    await assert.rejects(
      instance.getPayment('nx-payment-100'),
      (error: unknown) => error instanceof NaranjaXGatewayProtocolError,
    )
  }
})
