import assert from 'node:assert/strict'
import test from 'node:test'
import { getCancellationFulfillmentBlockMessage, isCancellationBlockingFulfillment } from '../src/services/fulfillment-policy'

test('bloquea fulfillment mientras el arrepentimiento o reintegro no está resuelto', () => {
  for (const status of ['REQUESTED', 'PROCESSING', 'FAILED']) {
    assert.equal(isCancellationBlockingFulfillment({ status }), true, status)
  }
})

test('no bloquea por ausencia de solicitud ni después del reintegro confirmado', () => {
  assert.equal(isCancellationBlockingFulfillment(null), false)
  assert.equal(isCancellationBlockingFulfillment(undefined), false)
  assert.equal(isCancellationBlockingFulfillment({ status: 'REFUNDED' }), false)
})

test('explica que la operación debe quedar detenida', () => {
  assert.match(getCancellationFulfillmentBlockMessage(), /no puede prepararse, despacharse ni entregarse/i)
})
