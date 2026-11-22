import assert from 'node:assert/strict'
import test from 'node:test'
import { NaranjaXHttpClient, NaranjaXHttpError } from '../src/services/naranja-x-http-client'

test('sends JSON to the configured HTTPS host and returns the decoded response', async () => {
  let capturedUrl = ''
  let capturedInit: RequestInit | undefined
  const client = new NaranjaXHttpClient({
    baseUrl: 'https://api.example.test/external/v1',
    fetchImpl: (async (input, init) => {
      capturedUrl = String(input)
      capturedInit = init
      return new Response(JSON.stringify({ id: 'payment-1', status: 'PENDING' }), { status: 200 })
    }) as typeof fetch,
  })

  const result = await client.request<{ id: string; status: string }>({
    method: 'POST',
    path: '/payments',
    headers: { authorization: 'Bearer test-token' },
    body: { reference: 'EV-1001', amount: 125000 },
  })

  assert.equal(capturedUrl, 'https://api.example.test/payments')
  assert.equal(capturedInit?.method, 'POST')
  assert.equal(new Headers(capturedInit?.headers).get('authorization'), 'Bearer test-token')
  assert.equal(new Headers(capturedInit?.headers).get('content-type'), 'application/json')
  assert.deepEqual(JSON.parse(String(capturedInit?.body)), { reference: 'EV-1001', amount: 125000 })
  assert.deepEqual(result, { id: 'payment-1', status: 'PENDING' })
})

test('rejects non-HTTPS base URLs and unsafe paths', async () => {
  assert.throws(
    () => new NaranjaXHttpClient({ baseUrl: 'http://api.example.test' }),
    (error: unknown) => error instanceof NaranjaXHttpError && error.code === 'INVALID_CONFIGURATION',
  )
  const client = new NaranjaXHttpClient({ baseUrl: 'https://api.example.test' })
  await assert.rejects(
    client.request({ method: 'GET', path: '//attacker.example/steal' }),
    (error: unknown) => error instanceof NaranjaXHttpError && error.code === 'INVALID_PATH',
  )
  await assert.rejects(
    client.request({ method: 'GET', path: 'https://attacker.example/steal' }),
    (error: unknown) => error instanceof NaranjaXHttpError && error.code === 'INVALID_PATH',
  )
})

test('surfaces provider HTTP status without exposing response bodies', async () => {
  const client = new NaranjaXHttpClient({
    baseUrl: 'https://api.example.test',
    fetchImpl: (async () => new Response('sensitive provider payload', { status: 503 })) as typeof fetch,
  })
  await assert.rejects(
    client.request({ method: 'GET', path: '/health' }),
    (error: unknown) => error instanceof NaranjaXHttpError
      && error.code === 'HTTP_ERROR'
      && error.status === 503
      && !error.message.includes('sensitive'),
  )
})

test('rejects malformed JSON and maps network and timeout failures', async () => {
  const malformed = new NaranjaXHttpClient({
    baseUrl: 'https://api.example.test',
    fetchImpl: (async () => new Response('{invalid', { status: 200 })) as typeof fetch,
  })
  await assert.rejects(
    malformed.request({ method: 'GET', path: '/health' }),
    (error: unknown) => error instanceof NaranjaXHttpError && error.code === 'INVALID_JSON',
  )

  const network = new NaranjaXHttpClient({
    baseUrl: 'https://api.example.test',
    fetchImpl: (async () => { throw new Error('socket details must not escape') }) as typeof fetch,
  })
  await assert.rejects(
    network.request({ method: 'GET', path: '/health' }),
    (error: unknown) => error instanceof NaranjaXHttpError
      && error.code === 'NETWORK_ERROR'
      && !error.message.includes('socket details'),
  )

  const timeout = new NaranjaXHttpClient({
    baseUrl: 'https://api.example.test',
    fetchImpl: (async () => { const error = new Error('aborted'); error.name = 'TimeoutError'; throw error }) as typeof fetch,
  })
  await assert.rejects(
    timeout.request({ method: 'GET', path: '/health' }),
    (error: unknown) => error instanceof NaranjaXHttpError && error.code === 'TIMEOUT',
  )
})
