import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import type { Request } from 'express'
import { env } from '../config/env'

export function deriveOrderAccessToken(checkoutRequestKey: string) {
  return createHmac('sha256', env.JWT_SECRET)
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
