import assert from 'node:assert/strict'
import test from 'node:test'
import type { NaranjaXPaymentSnapshot } from '../src/services/naranja-x-gateway'
import { reconcileNaranjaXPayment, resolveNaranjaXEffectiveStatus } from '../src/services/naranja-x-payment-reconciliation'

const expected = {
  providerPaymentId: 'nx_123',
  orderReference: 'VM-1001',
  amountArs: 125000,
  currencyCode: 'ARS',
}

function snapshot(overrides: Partial<NaranjaXPaymentSnapshot> = {}): NaranjaXPaymentSnapshot {
  return {
    providerPaymentId: expected.providerPaymentId,
    orderReference: expected.orderReference,
    amountArs: expected.amountArs,
    currency: 'ARS',
    status: 'APPROVED',
    refundedAmountArs: 0,
    ...overrides,
  }
}

test('accepts only a fully matching approved payment', () => {
  assert.deepEqual(reconcileNaranjaXPayment(snapshot(), expected), {
    valid: true, status: 'APPROVED', refundedAmountArs: 0,
  })
})

test('rejects mismatched provider ID, order reference, amount and currency', () => {
  assert.equal(reconcileNaranjaXPayment(snapshot({ providerPaymentId: 'other' }), expected).valid, false)
  assert.equal(reconcileNaranjaXPayment(snapshot({ orderReference: 'VM-OTHER' }), expected).valid, false)
  assert.equal(reconcileNaranjaXPayment(snapshot({ amountArs: 125001 }), expected).valid, false)
  assert.equal(reconcileNaranjaXPayment(snapshot({ currency: 'USD' }), expected).valid, false)
})

test('pending, rejected, cancelled and unknown states never become approved', () => {
  for (const status of ['PENDING', 'REJECTED', 'CANCELLED', 'UNKNOWN'] as const) {
    const result = reconcileNaranjaXPayment(snapshot({ status }), expected)
    assert.equal(result.valid, true)
    assert.equal(result.status, status)
  }
})

test('accepts partial and total refunds only with consistent amounts', () => {
  assert.deepEqual(
    reconcileNaranjaXPayment(snapshot({ status: 'PARTIALLY_REFUNDED', refundedAmountArs: 25000 }), expected),
    { valid: true, status: 'PARTIALLY_REFUNDED', refundedAmountArs: 25000 },
  )
  assert.deepEqual(
    reconcileNaranjaXPayment(snapshot({ status: 'REFUNDED', refundedAmountArs: 125000 }), expected),
    { valid: true, status: 'REFUNDED', refundedAmountArs: 125000 },
  )
  assert.equal(reconcileNaranjaXPayment(snapshot({ status: 'PARTIALLY_REFUNDED', refundedAmountArs: 125000 }), expected).valid, false)
  assert.equal(reconcileNaranjaXPayment(snapshot({ status: 'REFUNDED', refundedAmountArs: 1 }), expected).valid, false)
})

test('rejects negative, fractional and excessive refund amounts', () => {
  for (const refundedAmountArs of [-1, 0.5, 125001]) {
    assert.equal(reconcileNaranjaXPayment(snapshot({ status: 'PARTIALLY_REFUNDED', refundedAmountArs }), expected).valid, false)
  }
})

test('stale notifications cannot downgrade an approved or refunded payment', () => {
  assert.equal(resolveNaranjaXEffectiveStatus('APPROVED', 'PENDING'), 'APPROVED')
  assert.equal(resolveNaranjaXEffectiveStatus('APPROVED', 'UNKNOWN'), 'APPROVED')
  assert.equal(resolveNaranjaXEffectiveStatus('REFUNDED', 'APPROVED'), 'REFUNDED')
  assert.equal(resolveNaranjaXEffectiveStatus('PARTIALLY_REFUNDED', 'PENDING'), 'PARTIALLY_REFUNDED')
  assert.equal(resolveNaranjaXEffectiveStatus('PARTIALLY_REFUNDED', 'REFUNDED'), 'REFUNDED')
})

test('a rejected or cancelled payment is not reopened by stale pending events', () => {
  assert.equal(resolveNaranjaXEffectiveStatus('REJECTED', 'PENDING'), 'REJECTED')
  assert.equal(resolveNaranjaXEffectiveStatus('CANCELLED', 'UNKNOWN'), 'CANCELLED')
})
