import assert from 'node:assert/strict'
import test from 'node:test'
import { calculateCheckoutPrice } from '../src/services/checkout-pricing'

test('efectivo mantiene el precio publicado y no agrega recargo', () => {
  assert.deepEqual(calculateCheckoutPrice({
    paymentMethod: 'CASH',
    subtotalArs: 100000,
    shippingArs: 2500,
  }), {
    paymentMethod: 'CASH',
    subtotalArs: 100000,
    shippingArs: 2500,
    surchargeRateBps: 0,
    surchargeArs: 0,
    totalArs: 102500,
  })
})

test('GOcuotas aplica 9,9% más IVA sobre productos y envío', () => {
  const result = calculateCheckoutPrice({
    paymentMethod: 'GOCUOTAS',
    subtotalArs: 100000,
    shippingArs: 0,
  })
  assert.equal(result.surchargeRateBps, 11979)
  assert.equal(result.surchargeArs, 11979)
  assert.equal(result.totalArs, 111979)
})

test('Mercado Pago usa una tasa configurable y no inventa una comisión', () => {
  const withoutConfiguredRate = calculateCheckoutPrice({
    paymentMethod: 'MERCADO_PAGO',
    subtotalArs: 100000,
    shippingArs: 0,
  })
  assert.equal(withoutConfiguredRate.surchargeArs, 0)
  const configured = calculateCheckoutPrice({
    paymentMethod: 'MERCADO_PAGO',
    subtotalArs: 100000,
    shippingArs: 1500,
    mercadoPagoSurchargeBps: 500,
  })
  assert.equal(configured.surchargeArs, 5075)
  assert.equal(configured.totalArs, 106575)
})

test('redondea el recargo al peso y rechaza importes/tasas inválidos', () => {
  assert.equal(calculateCheckoutPrice({
    paymentMethod: 'GOCUOTAS',
    subtotalArs: 1,
    shippingArs: 0,
  }).surchargeArs, 1)
  assert.throws(() => calculateCheckoutPrice({
    paymentMethod: 'CASH',
    subtotalArs: -1,
    shippingArs: 0,
  }))
  assert.throws(() => calculateCheckoutPrice({
    paymentMethod: 'MERCADO_PAGO',
    subtotalArs: 100,
    shippingArs: 0,
    mercadoPagoSurchargeBps: -1,
  }))
})
