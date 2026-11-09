import { env } from '../config/env'

type EnviopackQuoteResponse = {
  modalidad?: string
  servicio?: string
  valor?: string | number
  horas_entrega?: number | string
  correo?: { id?: string; nombre?: string }
}

export type ShippingOption = {
  key: string
  carrierName: string
  carrierId: string | null
  serviceCode: string
  serviceLabel: string
  priceArs: number
  estimatedHours: number | null
}

let cachedToken: { value: string; expiresAt: number } | null = null

export class ShippingProviderError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ShippingProviderError'
  }
}

async function getAccessToken(): Promise<string> {
  if (!env.ENVIOPACK_API_KEY || !env.ENVIOPACK_SECRET_KEY) {
    throw new ShippingProviderError('La integración con Envíopack todavía no está configurada.')
  }
  if (cachedToken && cachedToken.expiresAt > Date.now()) return cachedToken.value

  const body = new URLSearchParams({
    'api-key': env.ENVIOPACK_API_KEY,
    'secret-key': env.ENVIOPACK_SECRET_KEY,
  })
  const response = await fetch('https://api.enviopack.com/auth', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(15000),
  })
  if (!response.ok) throw new ShippingProviderError('Envíopack no pudo autenticar la cuenta. Revisá las credenciales.')
  const payload = await response.json() as { access_token?: string }
  if (!payload.access_token) throw new ShippingProviderError('Envíopack devolvió una respuesta de autenticación inválida.')

  cachedToken = { value: payload.access_token, expiresAt: Date.now() + 3.8 * 60 * 60 * 1000 }
  return payload.access_token
}

const serviceNames: Record<string, string> = {
  N: 'Estándar',
  P: 'Prioritario',
  X: 'Express',
  R: 'Devolución',
}

export async function quoteHomeDelivery(input: {
  provinceCode: string
  postalCode: string
  weightGrams: number
  packages: Array<{ lengthCm: number; widthCm: number; heightCm: number }>
}): Promise<ShippingOption[]> {
  const token = await getAccessToken()
  const url = new URL('https://api.enviopack.com/cotizar/precio/a-domicilio')
  url.searchParams.set('access_token', token)
  url.searchParams.set('provincia', input.provinceCode)
  url.searchParams.set('codigo_postal', input.postalCode)
  url.searchParams.set('peso', (input.weightGrams / 1000).toFixed(2))
  url.searchParams.set('paquetes', input.packages
    .map((item) => `${item.heightCm}x${item.widthCm}x${item.lengthCm}`)
    .join(','))

  const response = await fetch(url, { signal: AbortSignal.timeout(20000) })
  if (!response.ok) throw new ShippingProviderError('Envíopack no pudo calcular el envío para ese destino.')
  const payload = await response.json() as EnviopackQuoteResponse[]
  if (!Array.isArray(payload)) throw new ShippingProviderError('Envíopack devolvió una cotización inválida.')

  return payload.flatMap((item, index) => {
    const price = Number(item.valor)
    if (!Number.isFinite(price) || price < 0) return []
    const serviceCode = item.servicio || 'N'
    const hours = Number(item.horas_entrega)
    return [{
      key: `${serviceCode}-${index}`,
      carrierName: item.correo?.nombre || 'Envíopack',
      carrierId: item.correo?.id || null,
      serviceCode,
      serviceLabel: serviceNames[serviceCode] || 'Servicio de envío',
      priceArs: Math.round(price),
      estimatedHours: Number.isFinite(hours) && hours > 0 ? hours : null,
    }]
  })
}
