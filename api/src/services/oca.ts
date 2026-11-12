import { getStoredOcaCredentials } from './shipping-settings'

export class OcaError extends Error {
  constructor(message: string, readonly statusCode = 502) {
    super(message)
    this.name = 'OcaError'
  }
}

const endpoints = {
  QA: 'https://integraciones.ocadev.com.ar/epak_tracking_test/Oep_TrackEPak.asmx',
  PRODUCTION: 'https://webservice.oca.com.ar/ePak_tracking/Oep_TrackEPak.asmx',
} as const

function readXmlValue(xml: string, names: string[]): string | null {
  const decoded = xml.replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&apos;/gi, "'").replace(/&amp;/gi, '&')
  for (const name of names) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const expression = new RegExp('<(?:[\\w.-]+:)?' + escaped + '(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:[\\w.-]+:)?' + escaped + '\\s*>', 'i')
    const match = decoded.match(expression)
    if (match?.[1]) return match[1].replace(/<[^>]+>/g, '').trim()
  }
  return null
}

export async function quoteOca(input: {
  postalCode: string
  weightGrams: number
  volumeCm3: number
  packages: number
  declaredValueArs: number
  originPostalCode: string
}) {
  const credentials = await getStoredOcaCredentials()
  if (!credentials) throw new OcaError('OCA todavía no está configurado. Cargá usuario e-Pak, contraseña, CUIT y operativa en Administración > Envíos.', 503)
  const url = new URL(`${endpoints[credentials.environment]}/Tarifar_Envio_Corporativo`)
  url.search = new URLSearchParams({
    Cuit: `${credentials.cuit.slice(0, 2)}-${credentials.cuit.slice(2, 10)}-${credentials.cuit.slice(10)}`,
    Operativa: credentials.operative,
    PesoTotal: (Math.ceil(input.weightGrams) / 1000).toFixed(3),
    VolumenTotal: (input.volumeCm3 / 1_000_000).toFixed(6),
    CodigoPostalOrigen: input.originPostalCode,
    CodigoPostalDestino: input.postalCode,
    CantidadPaquetes: String(input.packages),
    ValorDeclarado: String(Math.round(input.declaredValueArs)),
  }).toString()

  let response: Response
  try { response = await fetch(url, { signal: AbortSignal.timeout(20000) }) }
  catch { throw new OcaError('No se pudo conectar con OCA para cotizar el envío. Intentá nuevamente.') }
  if (!response.ok) throw new OcaError(`OCA respondió HTTP ${response.status} al cotizar el envío.`)
  const xml = await response.text()
  if (!xml || /<fault/i.test(xml)) throw new OcaError('OCA devolvió una respuesta de cotización inválida.')
  const priceText = readXmlValue(xml, ['Precio', 'Importe', 'Valor', 'Total', 'Tarifa', 'Tarifar_Envio_CorporativoResult'])
  const price = priceText === null ? NaN : Number(priceText.replace(/[^0-9,.-]/g, '').replace(',', '.'))
  if (!Number.isFinite(price) || price < 0) throw new OcaError('OCA respondió, pero el formato de tarifa debe validarse con una respuesta real de la cuenta.')
  const timeText = readXmlValue(xml, ['HorasEntrega', 'PlazoEntrega', 'TiempoEntrega', 'DiasEntrega'])
  const time = timeText === null ? NaN : Number(timeText.replace(',', '.'))
  return {
    key: `oca-${credentials.operative}`,
    carrierName: 'OCA',
    carrierId: null,
    serviceCode: credentials.operative,
    serviceLabel: 'OCA e-Pak',
    priceArs: Math.round(price),
    estimatedHours: Number.isFinite(time) && time > 0 ? Math.round(time <= 30 ? time * 24 : time) : null,
  }
}
