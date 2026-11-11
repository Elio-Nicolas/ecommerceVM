import assert from 'node:assert/strict'
import test from 'node:test'
import { wouldChangeOrderTotal } from '../src/services/shipping-total-consistency'

test('detecta un cambio de total aunque el costo de envío sea el mismo', () => {
  assert.equal(wouldChangeOrderTotal(10000, 1500, 12000), true)
})

test('no considera cambio cuando el total recalculado coincide', () => {
  assert.equal(wouldChangeOrderTotal(10000, 1500, 11500), false)
})

test('trata totales ausentes o fuera del rango seguro como cambios', () => {
  assert.equal(wouldChangeOrderTotal(10000, 1500, null), true)
  assert.equal(wouldChangeOrderTotal(Number.MAX_SAFE_INTEGER, 1, 0), true)
})
