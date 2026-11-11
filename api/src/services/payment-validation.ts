export function parsePaymentAmount(value: unknown): number | null {
  if ((typeof value !== 'string' && typeof value !== 'number') || (typeof value === 'string' && value.trim() === '')) return null
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 0) return null
  return parsed
}

export function isValidPaymentCheckoutUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false
  try {
    const url = new URL(value)
    return url.protocol === 'https:'
      && (url.hostname === 'mercadopago.com.ar'
        || url.hostname.endsWith('.mercadopago.com.ar')
        || url.hostname === 'mercadopago.com'
        || url.hostname.endsWith('.mercadopago.com'))
  } catch {
    return false
  }
}
