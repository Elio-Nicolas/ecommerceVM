import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import test from 'node:test'
import {
  getNaranjaXPublicConfig,
  reconcileNaranjaXPayment,
  verifyNaranjaXHmacSha256,
  type NaranjaXOrderContext,
  type NaranjaXPaymentSnapshot,
} from '../src/services/naranja-x-payment-policy'

const order: NaranjaXOrderContext = {
  orderId: 'order-123',
  expectedAmountArs: 125000,
  currencyCode: 'ARS',
  orderStatus: 'PENDING',
  hasCancellationRequest: false,
}
const payment: NaranjaXPaymentSnapshot = {
  providerPaymentId: 'nx-payment-456',
  merchantReference: 'order-123',
  amountArs: 125000,
  currencyCode: 'ARS',
  status: 'APPROVED',
}

test('approves only a matching, provider-confirmed payment', () => {
  assert.equal(reconcileNaranjaXPayment(order, payment).action, 'MARK_APPROVED')
})
test('keeps pending and unknown states pending', () => {
  for (const status of ['PENDING', 'UNKNOWN'] as const) {
    assert.equal(reconcileNaranjaXPayment(order, { ...payment, status }).action, 'KEEP_PENDING')
  }
})
test('rejects mismatched merchant reference for manual reconciliation', () => {
  assert.equal(reconcileNaranjaXPayment(order, { ...payment, merchantReference: 'other' }).action, 'RECONCILE_MANUALLY')
})
test('rejects mismatched, fractional, zero and unsafe amounts', () => {
  for (const amountArs of [124999, 125000.5, 0, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(reconcileNaranjaXPayment(order, { ...payment, amountArs }).action, 'RECONCILE_MANUALLY')
  }
})
test('rejects currency mismatch', () => {
  assert.equal(reconcileNaranjaXPayment(order, { ...payment, currencyCode: 'USD' }).action, 'RECONCILE_MANUALLY')
})
test('rejects missing external payment id', () => {
  assert.equal(reconcileNaranjaXPayment(order, { ...payment, providerPaymentId: ' ' }).action, 'RECONCILE_MANUALLY')
})
test('does not confirm a payment for a cancelled order', () => {
  assert.equal(reconcileNaranjaXPayment({ ...order, orderStatus: 'CANCELLED' }, payment).action, 'RECONCILE_MANUALLY')
})
test('does not confirm while a cancellation request exists', () => {
  assert.equal(reconcileNaranjaXPayment({ ...order, hasCancellationRequest: true }, payment).action, 'RECONCILE_MANUALLY')
})
test('does not approve after fulfillment has advanced', () => {
  assert.equal(reconcileNaranjaXPayment({ ...order, orderStatus: 'SHIPPED' }, payment).action, 'RECONCILE_MANUALLY')
})
test('maps terminal provider states without treating them as approval', () => {
  assert.equal(reconcileNaranjaXPayment(order, { ...payment, status: 'REJECTED' }).action, 'MARK_REJECTED')
  assert.equal(reconcileNaranjaXPayment(order, { ...payment, status: 'CANCELLED' }).action, 'MARK_CANCELLED')
  assert.equal(reconcileNaranjaXPayment(order, { ...payment, status: 'REFUNDED' }).action, 'MARK_REFUNDED')
  assert.equal(reconcileNaranjaXPayment(order, { ...payment, status: 'PARTIALLY_REFUNDED' }).action, 'MARK_PARTIALLY_REFUNDED')
})
test('ignores repeated final provider status', () => {
  assert.equal(reconcileNaranjaXPayment({ ...order, existingAttemptStatus: 'APPROVED' }, payment).action, 'IGNORE_DUPLICATE')
})
test('does not expose configuration as enabled until every secret/config field exists', () => {
  assert.deepEqual(getNaranjaXPublicConfig({ enabled: true }), { provider: 'NARANJA_X', enabled: false })
  assert.deepEqual(getNaranjaXPublicConfig({
    enabled: true, apiBaseUrl: 'https://api.example.test', partnerId: 'partner',
    apiCredential: 'credential', webhookSecret: 'secret',
  }), { provider: 'NARANJA_X', enabled: true })
  assert.equal(getNaranjaXPublicConfig({
    enabled: false, apiBaseUrl: 'https://api.example.test', partnerId: 'partner',
    apiCredential: 'credential', webhookSecret: 'secret',
  }).enabled, false)
})
test('verifies HMAC-SHA256 over the exact raw body bytes', () => {
  const body = Buffer.from('{"event":"payment.updated"}')
  const secret = 'sandbox-secret'
  const signature = createHmac('sha256', secret).update(body).digest('hex')
  assert.equal(verifyNaranjaXHmacSha256(body, signature, secret), true)
  assert.equal(verifyNaranjaXHmacSha256(body, signature.toUpperCase(), secret), true)
  assert.equal(verifyNaranjaXHmacSha256(Buffer.from('tampered'), signature, secret), false)
  assert.equal(verifyNaranjaXHmacSha256(body, signature, 'wrong-secret'), false)
  assert.equal(verifyNaranjaXHmacSha256(body, 'not-a-signature', secret), false)
  assert.equal(verifyNaranjaXHmacSha256(body, signature, ''), false)
})
