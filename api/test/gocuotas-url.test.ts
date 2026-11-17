import assert from 'node:assert/strict'
import test from 'node:test'
import { buildGoCuotasUrl } from '../src/services/gocuotas-url'

test('conserva el prefijo de API aunque la URL base tenga o no barra final', () => {
  assert.equal(
    buildGoCuotasUrl('authentication', 'https://sandbox.gocuotas.com/api_redirect/v1').toString(),
    'https://sandbox.gocuotas.com/api_redirect/v1/authentication',
  )
  assert.equal(
    buildGoCuotasUrl('/checkouts', 'https://sandbox.gocuotas.com/api_redirect/v1/').toString(),
    'https://sandbox.gocuotas.com/api_redirect/v1/checkouts',
  )
})

test('codifica identificadores de orden al construir la ruta', () => {
  assert.equal(
    buildGoCuotasUrl('orders/' + encodeURIComponent('order/123'), 'https://sandbox.gocuotas.com/api_redirect/v1/').toString(),
    'https://sandbox.gocuotas.com/api_redirect/v1/orders/order%2F123',
  )
})
