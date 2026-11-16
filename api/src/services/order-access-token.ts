import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import type { Request } from 'express'

export function deriveOrderAccessToken(checkoutRequestKey: string, secret: string) {
  return createHmac('sha256', secret)
    .update('ecommercevm:order-access:v1:' + checkoutRequestKey)
    .digest('hex')
}

export function hashOrderAccessToken(token: string) {
  return createHash('sha256').update(token).digest('hex')
}

export function hasValidOrderAccessToken(req: Request, storedHash: string | null | undefined) {
  const token = req.header('x-order-access-token')
  if (!storedHash || !token || !/^[a-f0-9]{64}$/i.test(token)) return false
  const supplied = Buffer.from(hashOrderAccessToken(token), 'hex')
  const expected = Buffer.from(storedHash, 'hex')
  return supplied.length === expected.length && timingSafeEqual(supplied, expected)
}
