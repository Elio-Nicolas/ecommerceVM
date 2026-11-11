import assert from 'node:assert/strict'
import test from 'node:test'
import { createCheckoutFingerprint } from '../src/services/order-checkout-fingerprint'

const checkout = () => ({
  customerName: 'Cliente de prueba',
  customerEmail: 'cliente@example.com',
  customerPhone: '2657123456',
  addressLine: 'San Martín 123',
  city: 'Villa Mercedes',
  province: 'San Luis',
  postalCode: '5730',
  deliveryMethod: 'PICKUP' as const,
  customerNotes: null,
  items: [
    { productId: '00000000-0000-4000-8000-000000000001', quantity: 2 },
    { productId: '00000000-0000-4000-8000-000000000002', quantity: 1 },
  ],
})

test('el fingerprint del checkout no depende del orden de los artículos', () => {
  const first = checkout()
  const second = { ...first, items: [...first.items].reverse() }
  assert.equal(createCheckoutFingerprint(first), createCheckoutFingerprint(second))
})

test('el fingerprint cambia si cambia un dato del comprador o entrega', () => {
  const original = checkout()
  assert.notEqual(createCheckoutFingerprint(original), createCheckoutFingerprint({ ...original, customerPhone: '2657987654' }))
  assert.notEqual(createCheckoutFingerprint(original), createCheckoutFingerprint({ ...original, postalCode: '5700' }))
  assert.notEqual(createCheckoutFingerprint(original), createCheckoutFingerprint({ ...original, deliveryMethod: 'LOCAL_DELIVERY' }))
})

test('el fingerprint cambia si cambia la cantidad o el producto', () => {
  const original = checkout()
  assert.notEqual(createCheckoutFingerprint(original), createCheckoutFingerprint({ ...original, items: original.items.map((item, index) => index === 0 ? { ...item, quantity: 3 } : item) }))
  assert.notEqual(createCheckoutFingerprint(original), createCheckoutFingerprint({ ...original, items: original.items.map((item, index) => index === 0 ? { ...item, productId: '00000000-0000-4000-8000-000000000003' } : item) }))
})
