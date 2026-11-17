import assert from 'node:assert/strict'
import test from 'node:test'
import { readGoCuotasCheckoutResponse } from '../src/services/gocuotas-checkout-response'

test('lee checkout JSON esperado y no incluye valores sensibles en el diagnóstico', async () => {
  const response = new Response(JSON.stringify({ id: 123, url_init: 'https://sandbox.gocuotas.com/checkout/secret-path', customer_email: 'buyer@example.com' }), {
    status: 201,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
  const result = await readGoCuotasCheckoutResponse(response)

  assert.deepEqual(result.payload, {
    id: 123,
    url_init: 'https://sandbox.gocuotas.com/checkout/secret-path',
    customer_email: 'buyer@example.com',
  })
  assert.match(result.diagnostic, /HTTP 201/)
  assert.match(result.diagnostic, /keys=customer_email,id,url_init/)
  assert.doesNotMatch(result.diagnostic, /buyer@example|secret-path/)
})

test('describe una respuesta JSON con estructura distinta sin guardar sus valores', async () => {
  const response = new Response(JSON.stringify({ data: { checkout_id: 'abc', checkout_url: 'https://example.test/private' }, message: 'private provider message' }), {
    status: 201,
    headers: { 'content-type': 'application/json' },
  })
  const result = await readGoCuotasCheckoutResponse(response)

  assert.equal(result.payload?.id, undefined)
  assert.match(result.diagnostic, /keys=data,message/)
  assert.doesNotMatch(result.diagnostic, /abc|private|example\.test/)
})

test('maneja respuestas no JSON y cuerpos vacíos', async () => {
  const nonJson = await readGoCuotasCheckoutResponse(new Response('provider failure details', {
    status: 502,
    headers: { 'content-type': 'text/plain' },
  }))
  assert.match(nonJson.diagnostic, /HTTP 502/)
  assert.match(nonJson.diagnostic, /body=non-json/)
  assert.doesNotMatch(nonJson.diagnostic, /provider failure details/)

  const empty = await readGoCuotasCheckoutResponse(new Response(null, { status: 204 }))
  assert.match(empty.diagnostic, /body=empty/)
})


test('acepta la respuesta documentada de GOcuotas con url_init sin id', async () => {
  const response = new Response(JSON.stringify({ url_init: 'https://sandbox.gocuotas.com/checkout/test-token' }), {
    status: 201,
    headers: { 'content-type': 'application/json' },
  })
  const result = await readGoCuotasCheckoutResponse(response)

  assert.deepEqual(result.payload, { url_init: 'https://sandbox.gocuotas.com/checkout/test-token' })
  assert.match(result.diagnostic, /id=missing/)
  assert.match(result.diagnostic, /url_init=string/)
})
