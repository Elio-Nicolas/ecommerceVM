import assert from 'node:assert/strict'
import test from 'node:test'
import { shippingCartFingerprint } from '../src/services/shipping-fingerprint'

const products = [
  {
    id: 'product-a',
    priceArs: 12500,
    weightGrams: 450,
    packageLengthCm: 20,
    packageWidthCm: 15,
    packageHeightCm: 8,
  },
  {
    id: 'product-b',
    priceArs: 8900,
    weightGrams: 700,
    packageLengthCm: 30,
    packageWidthCm: 18,
    packageHeightCm: 10,
  },
]

test('el fingerprint no depende del orden de los artículos', () => {
  const first = shippingCartFingerprint([
    { productId: 'product-a', quantity: 2 },
    { productId: 'product-b', quantity: 1 },
  ], products)

  const reordered = shippingCartFingerprint([
    { productId: 'product-b', quantity: 1 },
    { productId: 'product-a', quantity: 2 },
  ], [...products].reverse())

  assert.equal(first, reordered)
})

test('el fingerprint cambia cuando cambia una cantidad', () => {
  const original = shippingCartFingerprint([{ productId: 'product-a', quantity: 1 }], products)
  const changed = shippingCartFingerprint([{ productId: 'product-a', quantity: 2 }], products)

  assert.notEqual(original, changed)
})

test('el fingerprint cambia cuando cambia el precio del producto', () => {
  const original = shippingCartFingerprint([{ productId: 'product-a', quantity: 1 }], products)
  const repriced = shippingCartFingerprint([{ productId: 'product-a', quantity: 1 }], [
    { ...products[0], priceArs: products[0].priceArs + 1 },
  ])

  assert.notEqual(original, repriced)
})

test('el fingerprint cambia cuando cambian peso o dimensiones', () => {
  const original = shippingCartFingerprint([{ productId: 'product-a', quantity: 1 }], products)
  const changedPackage = shippingCartFingerprint([{ productId: 'product-a', quantity: 1 }], [
    { ...products[0], packageHeightCm: products[0].packageHeightCm + 1 },
  ])

  assert.notEqual(original, changedPackage)
})

test('el carrito vacío produce un fingerprint estable', () => {
  const first = shippingCartFingerprint([], [])
  const second = shippingCartFingerprint([], [])

  assert.match(first, /^[a-f0-9]{64}$/)
  assert.equal(first, second)
})
