import assert from 'node:assert/strict'
import test from 'node:test'
import { paymentAmountsMatchCurrentOrder } from '../src/services/payment-order-consistency'

test('acepta el pago solo cuando proveedor, intento y pedido tienen el mismo importe', () => {
  assert.equal(paymentAmountsMatchCurrentOrder(12500, 12500, 12500), true)
})

test('rechaza un pago si el total del pedido cambió después de crear el intento', () => {
  assert.equal(paymentAmountsMatchCurrentOrder(12500, 12500, 15000), false)
  assert.equal(paymentAmountsMatchCurrentOrder(15000, 12500, 15000), false)
})

test('rechaza importes ausentes, no seguros o inválidos', () => {
  assert.equal(paymentAmountsMatchCurrentOrder(null, 12500, 12500), false)
  assert.equal(paymentAmountsMatchCurrentOrder(12500, 12500, null), false)
  assert.equal(paymentAmountsMatchCurrentOrder(12500, 0, 12500), false)
  assert.equal(paymentAmountsMatchCurrentOrder(12500, Number.MAX_SAFE_INTEGER + 1, 12500), false)
})
