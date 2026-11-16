import assert from 'node:assert/strict'
import test from 'node:test'
import type { Request } from 'express'
import { deriveOrderAccessToken, hashOrderAccessToken, hasValidOrderAccessToken } from '../src/services/order-access-token'

const secret = 'test-secret-with-at-least-32-characters'

function requestWithToken(token?: string) {
  return { header: (name: string) => name.toLowerCase() === 'x-order-access-token' ? token : undefined } as unknown as Request
}

test('deriva un token estable para reintentos idempotentes y distinto por checkout', () => {
  const key = 'a0f15b5b-46f8-4d57-8a1a-51f8128dfe55'
  assert.equal(deriveOrderAccessToken(key, secret), deriveOrderAccessToken(key, secret))
  assert.notEqual(deriveOrderAccessToken(key, secret), deriveOrderAccessToken('b0f15b5b-46f8-4d57-8a1a-51f8128dfe55', secret))
  assert.equal(deriveOrderAccessToken(key, secret).length, 64)
})

test('autoriza únicamente el token correcto y un hash almacenado válido', () => {
  const token = deriveOrderAccessToken('a0f15b5b-46f8-4d57-8a1a-51f8128dfe55', secret)
  const storedHash = hashOrderAccessToken(token)
  assert.equal(hasValidOrderAccessToken(requestWithToken(token), storedHash), true)
  assert.equal(hasValidOrderAccessToken(requestWithToken('f'.repeat(64)), storedHash), false)
  assert.equal(hasValidOrderAccessToken(requestWithToken(), storedHash), false)
  assert.equal(hasValidOrderAccessToken(requestWithToken(token), null), false)
  assert.equal(hasValidOrderAccessToken(requestWithToken(token), 'invalid'), false)
})
