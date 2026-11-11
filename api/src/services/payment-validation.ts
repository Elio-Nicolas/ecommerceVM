export function parsePaymentAmount(value: unknown): number | null {
  if ((typeof value !== 'string' && typeof value !== 'number') || (typeof value === 'string' && value.trim() === '')) return null
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0 || Math.abs(parsed - Math.round(parsed)) > 0.00001) return null
  return Number.isSafeInteger(Math.round(parsed)) ? Math.round(parsed) : null
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
