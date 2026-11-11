import assert from 'node:assert/strict'
import test from 'node:test'
import { isValidPaymentCheckoutUrl, parsePaymentAmount } from '../src/services/payment-validation'

test('acepta importes enteros en ARS como número o texto', () => {
  assert.equal(parsePaymentAmount(12500), 12500)
  assert.equal(parsePaymentAmount('12500'), 12500)
  assert.equal(parsePaymentAmount('12500.000001'), 12500)
})

test('rechaza importes negativos, fraccionarios, infinitos y no numéricos', () => {
  for (const value of [-1, '-1', 10.5, '10.5', Infinity, 'NaN', null, undefined, {}, '']) {
    assert.equal(parsePaymentAmount(value), null, String(value))
  }
})

test('rechaza importes enteros fuera del rango seguro', () => {
  assert.equal(parsePaymentAmount(Number.MAX_SAFE_INTEGER + 1), null)
})

test('acepta únicamente URLs HTTPS oficiales de Mercado Pago', () => {
  assert.equal(isValidPaymentCheckoutUrl('https://www.mercadopago.com.ar/checkout/v1/redirect'), true)
  assert.equal(isValidPaymentCheckoutUrl('https://mercadopago.com/checkout'), true)
  assert.equal(isValidPaymentCheckoutUrl('https://secure.mercadopago.com.ar/checkout'), true)
})

test('rechaza HTTP, dominios parecidos y URLs malformadas', () => {
  for (const value of [
    'http://mercadopago.com.ar/checkout',
    'https://mercadopago.com.ar.example.com/checkout',
    'https://mercadopago.com.evil.test/checkout',
    'https://evilmercadopago.com.ar/checkout',
    'javascript:alert(1)',
    'not-a-url',
    null,
    123,
  ]) {
    assert.equal(isValidPaymentCheckoutUrl(value), false, String(value))
  }
})
