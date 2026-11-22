import assert from 'node:assert/strict'
import test from 'node:test'
import { NaranjaXSimulator } from '../src/services/naranja-x-gateway'
import { NaranjaXAttemptError, startNaranjaXPaymentAttempt, type NaranjaXAttemptRecord, type NaranjaXAttemptStore } from '../src/services/naranja-x-payment-attempt'

function fixture(totalArs: number | null = 125000) {
  const order = { id: 'order-1', code: 'EV-1001', totalArs, status: 'PENDING' }
  const attempts: NaranjaXAttemptRecord[] = []
  let sequence = 0
  const store: NaranjaXAttemptStore = {
    async findOrder(id) { return id === order.id ? order : null },
    async findByRequestKey(key) { return attempts.find((item) => item.requestKey === key) ?? null },
    async findActiveForOrder(id) { return attempts.find((item) => item.orderId === id && ['CREATING', 'PENDING', 'UNKNOWN'].includes(item.status)) ?? null },
    async create(input) {
      sequence += 1
      const attempt: NaranjaXAttemptRecord = { id: String(sequence), ...input, provider: 'NARANJA_X', currencyCode: 'ARS', status: 'CREATING', providerOrderId: null, checkoutUrl: null }
      attempts.push(attempt)
      return attempt
    },
    async update(id, input) {
      const index = attempts.findIndex((item) => item.id === id)
      attempts[index] = { ...attempts[index], ...input }
      return attempts[index]
    },
  }
  return { order, attempts, store }
}

const input = { orderId: 'order-1', requestKey: 'request-1', returnUrl: 'https://shop.example/return', webhookUrl: 'https://api.example/webhook' }

test('persists one pending attempt and returns the provider checkout URL', async () => {
  const f = fixture()
  const result = await startNaranjaXPaymentAttempt(input, { enabled: true, store: f.store, gateway: new NaranjaXSimulator() })
  assert.equal(f.attempts.length, 1)
  assert.equal(result.attempt.status, 'PENDING')
  assert.equal(result.attempt.provider, 'NARANJA_X')
  assert.equal(result.checkoutUrl, 'https://naranja-x-simulator.invalid/checkout/nx_sim_1')
})

test('retries with the same key reuse the persisted checkout without creating another payment', async () => {
  const f = fixture()
  const gateway = new NaranjaXSimulator()
  const first = await startNaranjaXPaymentAttempt(input, { enabled: true, store: f.store, gateway })
  const second = await startNaranjaXPaymentAttempt(input, { enabled: true, store: f.store, gateway })
  assert.equal(f.attempts.length, 1)
  assert.equal(second.attempt.id, first.attempt.id)
  assert.equal(second.checkoutUrl, first.checkoutUrl)
})

test('disabled gateway cannot create an attempt', async () => {
  const f = fixture()
  await assert.rejects(
    startNaranjaXPaymentAttempt(input, { enabled: false, store: f.store, gateway: new NaranjaXSimulator() }),
    (error: unknown) => error instanceof NaranjaXAttemptError && error.code === 'NARANJA_X_DISABLED',
  )
  assert.equal(f.attempts.length, 0)
})

test('rejects missing totals, cancelled orders and non-HTTPS callback URLs', async () => {
  const missing = fixture(null)
  await assert.rejects(startNaranjaXPaymentAttempt(input, { enabled: true, store: missing.store, gateway: new NaranjaXSimulator() }))
  const cancelled = fixture()
  cancelled.order.status = 'CANCELLED'
  await assert.rejects(startNaranjaXPaymentAttempt(input, { enabled: true, store: cancelled.store, gateway: new NaranjaXSimulator() }))
  const badUrl = { ...input, returnUrl: 'http://shop.example/return' }
  await assert.rejects(startNaranjaXPaymentAttempt(badUrl, { enabled: true, store: fixture().store, gateway: new NaranjaXSimulator() }))
})

test('does not create a second active attempt for the same order', async () => {
  const f = fixture()
  const gateway = new NaranjaXSimulator()
  await startNaranjaXPaymentAttempt(input, { enabled: true, store: f.store, gateway })
  await assert.rejects(
    startNaranjaXPaymentAttempt({ ...input, requestKey: 'request-2' }, { enabled: true, store: f.store, gateway }),
    (error: unknown) => error instanceof NaranjaXAttemptError && error.code === 'ACTIVE_ATTEMPT_EXISTS',
  )
})

test('provider response mismatch is never persisted as pending', async () => {
  const f = fixture()
  const badGateway = {
    async createCheckout() {
      return { providerPaymentId: 'nx_bad', checkoutUrl: 'https://provider.example/checkout', status: 'APPROVED' as const, amountArs: 125000, currency: 'ARS' as const, orderReference: 'EV-1001' }
    },
    async getPayment() { throw new Error('not used') },
  }
  await assert.rejects(startNaranjaXPaymentAttempt(input, { enabled: true, store: f.store, gateway: badGateway }))
  assert.equal(f.attempts[0].status, 'UNKNOWN')
  assert.equal(f.attempts[0].checkoutUrl, null)
})
