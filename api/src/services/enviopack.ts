import { env } from '../config/env'

type EnviopackQuoteResponse = {
  modalidad?: string
  despacho?: string
  servicio?: string
  valor?: string | number
  horas_entrega?: number | string
  correo?: { id?: string; nombre?: string }
}

export type SellerShippingOption = {
  carrierId: string
  carrierName: string
  costArs: number
  estimatedHours: number | null
  fulfillmentMode: string
}

export type ShippingOption = {
  key: string
  carrierName: string
  carrierId: string | null
  serviceCode: string
  serviceLabel: string
  priceArs: number
  estimatedHours: number | null
  sellerOptions: SellerShippingOption[]
  sellerCostStatus: 'AVAILABLE' | 'UNAVAILABLE'
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
  let response: Response
  try {
    response = await fetch('https://api.enviopack.com/auth', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(15000),
    })
  } catch {
    throw new ShippingProviderError('No se pudo conectar con Envíopack. Intentá nuevamente en unos minutos.')
  }
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

async function getQuotePayload(url: URL): Promise<EnviopackQuoteResponse[]> {
  let response: Response
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(20000) })
  } catch {
    throw new ShippingProviderError('No se pudo conectar con Envíopack para cotizar el envío. Intentá nuevamente.')
  }
  if (!response.ok) throw new ShippingProviderError('Envíopack no pudo calcular el envío para ese destino.')
  const payload = await response.json() as EnviopackQuoteResponse[]
  if (!Array.isArray(payload)) throw new ShippingProviderError('Envíopack devolvió una cotización inválida.')
  return payload
}

export async function quoteHomeDelivery(input: {
  provinceCode: string
  postalCode: string
  weightGrams: number
  packages: Array<{ lengthCm: number; widthCm: number; heightCm: number }>
  originAddressId?: string | null
}): Promise<ShippingOption[]> {
  const token = await getAccessToken()
  const packages = input.packages
    .map((item) => `${item.heightCm}x${item.widthCm}x${item.lengthCm}`)
    .join(',')
  const baseParams = (url: URL) => {
    url.searchParams.set('access_token', token)
    url.searchParams.set('provincia', input.provinceCode)
    url.searchParams.set('codigo_postal', input.postalCode)
    url.searchParams.set('peso', (input.weightGrams / 1000).toFixed(2))
    url.searchParams.set('paquetes', packages)
    if (input.originAddressId) url.searchParams.set('direccion_envio', input.originAddressId)
  }

  const buyerUrl = new URL('https://api.enviopack.com/cotizar/precio/a-domicilio')
  baseParams(buyerUrl)
  const buyerQuotes = await getQuotePayload(buyerUrl)

  const sellerCostsByService = new Map<string, SellerShippingOption[]>()
  const serviceCodes = [...new Set(buyerQuotes.map((quote) => quote.servicio || 'N'))]
  await Promise.all(serviceCodes.map(async (serviceCode) => {
    const sellerUrl = new URL('https://api.enviopack.com/cotizar/costo')
    baseParams(sellerUrl)
    sellerUrl.searchParams.set('modalidad', 'D')
    sellerUrl.searchParams.set('despacho', 'D')
    sellerUrl.searchParams.set('servicio', serviceCode)
    let sellerQuotes: EnviopackQuoteResponse[] = []
    try {
      sellerQuotes = await getQuotePayload(sellerUrl)
    } catch {
      sellerCostsByService.set(serviceCode, [])
      return
    }
    const sellerOptions = sellerQuotes.flatMap((quote) => {
      const cost = Number(quote.valor)
      const carrierId = quote.correo?.id
      if (!carrierId || !Number.isFinite(cost) || cost < 0) return []
      const hours = Number(quote.horas_entrega)
      return [{
        carrierId,
        carrierName: quote.correo?.nombre || carrierId,
        costArs: Math.round(cost),
        estimatedHours: Number.isFinite(hours) && hours > 0 ? hours : null,
        fulfillmentMode: quote.despacho || 'D',
      }]
    })
    sellerCostsByService.set(serviceCode, sellerOptions)
  }))

  return buyerQuotes.flatMap((item, index) => {
    const price = Number(item.valor)
    if (!Number.isFinite(price) || price < 0) return []
    const serviceCode = item.servicio || 'N'
    const hours = Number(item.horas_entrega)
    return [{
      key: `${serviceCode}-${index}`,
      carrierName: 'Envíopack',
      carrierId: null,
      serviceCode,
      serviceLabel: serviceNames[serviceCode] || 'Servicio de envío',
      priceArs: Math.round(price),
      estimatedHours: Number.isFinite(hours) && hours > 0 ? hours : null,
      sellerOptions: sellerCostsByService.get(serviceCode) || [],
      sellerCostStatus: (sellerCostsByService.get(serviceCode)?.length || 0) > 0 ? 'AVAILABLE' : 'UNAVAILABLE',
    }]
  })
}
