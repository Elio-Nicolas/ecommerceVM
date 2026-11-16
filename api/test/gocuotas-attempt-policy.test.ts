import assert from 'node:assert/strict'
import test from 'node:test'
import { getGoCuotasAttemptDisposition, getGoCuotasFailureDisposition } from '../src/services/gocuotas-attempt-policy'

test('reutiliza un checkout GOcuotas solo si el intento PENDING tiene URL persistida', () => {
  assert.equal(getGoCuotasAttemptDisposition({ status: 'PENDING', checkoutUrl: 'https://checkout.gocuotas.com/example' }), 'REUSE_CHECKOUT')
})

test('bloquea reintentos para intentos CREATING o UNKNOWN para evitar POST duplicados', () => {
  assert.equal(getGoCuotasAttemptDisposition({ status: 'CREATING', checkoutUrl: null }), 'BLOCK_RETRY')
  assert.equal(getGoCuotasAttemptDisposition({ status: 'UNKNOWN', checkoutUrl: null }), 'BLOCK_RETRY')
})

test('bloquea estados inconsistentes o terminales sin generar otro checkout', () => {
  assert.equal(getGoCuotasAttemptDisposition({ status: 'PENDING', checkoutUrl: null }), 'BLOCK_RETRY')
  assert.equal(getGoCuotasAttemptDisposition({ status: 'APPROVED', checkoutUrl: null }), 'BLOCK_RETRY')
  assert.equal(getGoCuotasAttemptDisposition({ status: 'REJECTED', checkoutUrl: null }), 'BLOCK_RETRY')
})

test('permite reintentar si falla autenticación antes de enviar POST checkouts', () => {
  assert.equal(getGoCuotasFailureDisposition(false), 'RELEASE_ATTEMPT')
})

test('bloquea reintentos automáticos si el POST de checkout pudo llegar al proveedor', () => {
  assert.equal(getGoCuotasFailureDisposition(true), 'MARK_UNKNOWN')
})
