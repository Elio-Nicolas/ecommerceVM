import { createHmac, timingSafeEqual } from 'node:crypto'

export function verifyMercadoPagoWebhookSignature(
  signature: string,
  requestId: string,
  dataId: string,
  secret: string,
  nowMs = Date.now(),
): boolean {
  if (!secret || !requestId || !dataId) return false
  const parts = new Map(signature.split(',').map((part) => {
    const [key, ...rest] = part.trim().split('=')
    return [key, rest.join('=')]
  }))
  const timestamp = parts.get('ts')
  const receivedHash = parts.get('v1')
  if (!timestamp || !receivedHash || !/^[a-f0-9]{64}$/i.test(receivedHash)) return false
  const rawTimestamp = Number(timestamp)
  if (!Number.isFinite(rawTimestamp) || rawTimestamp <= 0) return false
  const timestampMs = rawTimestamp > 1_000_000_000_000 ? rawTimestamp : rawTimestamp * 1000
  if (Math.abs(nowMs - timestampMs) > 5 * 60 * 1000) return false
  const manifest = 'id:' + dataId + ';request-id:' + requestId + ';ts:' + timestamp + ';'
  const expectedHash = createHmac('sha256', secret).update(manifest).digest()
  const suppliedHash = Buffer.from(receivedHash, 'hex')
  return suppliedHash.length === expectedHash.length && timingSafeEqual(suppliedHash, expectedHash)
}
