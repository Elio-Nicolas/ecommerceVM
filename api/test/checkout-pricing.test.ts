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
    surchargeRateMilliPercent: 0,
    surchargeArs: 0,
    totalArs: 102500,
  })
})

test('GOcuotas gross-up 11,979% de comisión sobre el total para conservar neto el precio base', () => {
  const result = calculateCheckoutPrice({
    paymentMethod: 'GOCUOTAS',
    subtotalArs: 100000,
    shippingArs: 0,
  })
  assert.equal(result.surchargeRateMilliPercent, 13609)
  assert.equal(result.surchargeArs, 13609)
  assert.equal(result.totalArs, 113609)
  // La comisión estimada sobre el total queda cubierta por el recargo (redondeo al peso).
  assert.equal(Math.round(result.totalArs * 11979 / 100000), result.surchargeArs)
})

test('Mercado Pago a 10 días cubre comisión del 4,39% más IVA estimado', () => {
  const configured = calculateCheckoutPrice({
    paymentMethod: 'MERCADO_PAGO',
    subtotalArs: 50000,
    shippingArs: 0,
    mercadoPagoSurchargeMilliPercent: 5610,
  })
  assert.equal(configured.surchargeRateMilliPercent, 5610)
  assert.equal(configured.surchargeArs, 2805)
  assert.equal(configured.totalArs, 52805)
})

test('Mercado Pago usa una tasa configurable', () => {
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
    mercadoPagoSurchargeMilliPercent: 5000,
  })
  assert.equal(configured.surchargeArs, 5075)
  assert.equal(configured.totalArs, 106575)
})

test('redondea el recargo al peso y rechaza importes/tasas inválidos', () => {
  assert.equal(calculateCheckoutPrice({
    paymentMethod: 'GOCUOTAS',
    subtotalArs: 5,
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
    mercadoPagoSurchargeMilliPercent: -1,
  }))
})
