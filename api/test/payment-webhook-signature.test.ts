import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import test from 'node:test'
import { verifyMercadoPagoWebhookSignature } from '../src/services/payment-webhook-signature'

const secret = 'test-webhook-secret'
const requestId = 'request-123'
const dataId = 'order-456'
const now = 1_800_000_000_000

function signed(timestamp: string, id = dataId, request = requestId) {
  const manifest = 'id:' + id + ';request-id:' + request + ';ts:' + timestamp + ';'
  const hash = createHmac('sha256', secret).update(manifest).digest('hex')
  return 'ts=' + timestamp + ',v1=' + hash
}

test('acepta una firma válida con timestamp en milisegundos', () => {
  assert.equal(verifyMercadoPagoWebhookSignature(signed(String(now)), requestId, dataId, secret, now), true)
})

test('acepta una firma válida con timestamp en segundos', () => {
  const timestamp = String(Math.floor(now / 1000))
  assert.equal(verifyMercadoPagoWebhookSignature(signed(timestamp), requestId, dataId, secret, now), true)
})

test('rechaza firmas alteradas o vinculadas a otra orden o request', () => {
  const signature = signed(String(now))
  assert.equal(verifyMercadoPagoWebhookSignature(signature, requestId, 'other-order', secret, now), false)
  assert.equal(verifyMercadoPagoWebhookSignature(signature, 'other-request', dataId, secret, now), false)
  assert.equal(verifyMercadoPagoWebhookSignature(signature.replace(/v1=./, 'v1=f'), requestId, dataId, secret, now), false)
})

test('rechaza firmas vencidas, timestamps inválidos y secretos ausentes', () => {
  assert.equal(verifyMercadoPagoWebhookSignature(signed(String(now - 5 * 60 * 1000 - 1)), requestId, dataId, secret, now), false)
  assert.equal(verifyMercadoPagoWebhookSignature('ts=no,v1=' + 'a'.repeat(64), requestId, dataId, secret, now), false)
  assert.equal(verifyMercadoPagoWebhookSignature(signed(String(now)), requestId, dataId, '', now), false)
  assert.equal(verifyMercadoPagoWebhookSignature('', requestId, dataId, secret, now), false)
})
