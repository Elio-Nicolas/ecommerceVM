import { createHash } from 'node:crypto'

export function createCheckoutFingerprint<T extends {
  items: Array<{ productId: string; quantity: number }>
}>(input: T): string {
  const canonical = {
    ...input,
    items: [...input.items].sort((a, b) => a.productId.localeCompare(b.productId)),
  }
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex')
}
