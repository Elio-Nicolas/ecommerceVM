import assert from 'node:assert/strict'
import test from 'node:test'
import { isPaymentMethodEnabled, type PaymentMethodAvailabilitySettings } from '../src/services/payment-method-availability'

const allEnabled: PaymentMethodAvailabilitySettings = {
  cashEnabled: true,
  mercadoPagoEnabled: true,
  goCuotasEnabled: true,
}

test('allows each payment method when its setting is enabled', () => {
  assert.equal(isPaymentMethodEnabled('CASH', allEnabled), true)
  assert.equal(isPaymentMethodEnabled('MERCADO_PAGO', allEnabled), true)
  assert.equal(isPaymentMethodEnabled('GOCUOTAS', allEnabled), true)
})

test('blocks only the payment method disabled for maintenance', () => {
  assert.equal(isPaymentMethodEnabled('CASH', { ...allEnabled, cashEnabled: false }), false)
  assert.equal(isPaymentMethodEnabled('MERCADO_PAGO', { ...allEnabled, mercadoPagoEnabled: false }), false)
  assert.equal(isPaymentMethodEnabled('GOCUOTAS', { ...allEnabled, goCuotasEnabled: false }), false)
  assert.equal(isPaymentMethodEnabled('MERCADO_PAGO', { ...allEnabled, cashEnabled: false }), true)
})

test('fails closed for unknown and not-yet-integrated payment methods', () => {
  assert.equal(isPaymentMethodEnabled('NARANJA_X', allEnabled), false)
  assert.equal(isPaymentMethodEnabled('UNKNOWN', allEnabled), false)
})

test('blocks all methods when all switches are off', () => {
  const allDisabled = { cashEnabled: false, mercadoPagoEnabled: false, goCuotasEnabled: false }
  for (const method of ['CASH', 'MERCADO_PAGO', 'GOCUOTAS', 'NARANJA_X']) {
    assert.equal(isPaymentMethodEnabled(method, allDisabled), false)
  }
})
