import assert from 'node:assert/strict'
import test from 'node:test'
import { getShippingDispatchBlock } from '../src/services/shipping-dispatch-policy'

test('OCA solo permite despacho con admisión procesada y tracking no vacío', () => {
  assert.equal(getShippingDispatchBlock({ deliveryMethod: 'OCA', shipments: [] })?.code, 'OCA_SHIPMENT_NOT_PROCESSED')
  assert.equal(getShippingDispatchBlock({ deliveryMethod: 'OCA', shipments: [{ provider: 'OCA', status: 'CREATED', trackingNumber: '123' }] })?.code, 'OCA_SHIPMENT_NOT_PROCESSED')
  assert.equal(getShippingDispatchBlock({ deliveryMethod: 'OCA', shipments: [{ provider: 'OCA', status: 'PROCESSED', trackingNumber: '  ' }] })?.code, 'OCA_SHIPMENT_NOT_PROCESSED')
  assert.equal(getShippingDispatchBlock({ deliveryMethod: 'OCA', shipments: [{ provider: 'OCA', status: 'PROCESSED', trackingNumber: '123' }] }), null)
})

test('Andreani exige su propio envío procesado y tracking', () => {
  assert.equal(getShippingDispatchBlock({
    deliveryMethod: 'ANDREANI',
    shipments: [{ provider: 'OCA', status: 'PROCESSED', trackingNumber: '123' }],
  })?.code, 'ANDREANI_SHIPMENT_NOT_PROCESSED')
  assert.equal(getShippingDispatchBlock({
    deliveryMethod: 'ANDREANI',
    shipments: [{ provider: 'ANDREANI', status: 'PROCESSED', trackingNumber: 'AND-123' }],
  }), null)
})

test('entrega local A coordinar exige costo antes del despacho', () => {
  assert.equal(getShippingDispatchBlock({ deliveryMethod: 'LOCAL_DELIVERY', shippingService: 'A coordinar', shippingCostArs: null })?.code, 'LOCAL_DELIVERY_COST_REQUIRED')
  assert.equal(getShippingDispatchBlock({ deliveryMethod: 'LOCAL_DELIVERY', shippingService: 'A coordinar', shippingCostArs: 0 }), null)
})

test('retiro, entrega local con tarifa fija y otros métodos no agregan bloqueos', () => {
  assert.equal(getShippingDispatchBlock({ deliveryMethod: 'PICKUP' }), null)
  assert.equal(getShippingDispatchBlock({ deliveryMethod: 'LOCAL_DELIVERY', shippingService: 'Tarifa fija', shippingCostArs: null }), null)
})
