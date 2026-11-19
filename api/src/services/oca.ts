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

function decodeXml(xml: string): string {
  return xml
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&amp;/gi, '&')
}

function readXmlValue(xml: string, names: string[]): string | null {
  const decoded = decodeXml(xml)
  for (const name of names) {
    const escaped = name.replace(/[.*+?^$()|[\]\\]/g, '\\$&')
    const expression = new RegExp('<(?:[\\w.-]+:)?' + escaped + '(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:[\\w.-]+:)?' + escaped + '\\s*>', 'i')
    const match = decoded.match(expression)
    if (match?.[1]) {
      return match[1]
        .replace(/^\s*<!\[CDATA\[/i, '')
        .replace(/\]\]>\s*$/i, '')
        .replace(/<[^>]+>/g, '')
        .trim()
    }
  }
  return null
}

function parseOcaNumber(value: string): number {
  const normalized = value.replace(/[^0-9,.-]/g, '')
  if (!normalized || !/[0-9]/.test(normalized)) return NaN

  const comma = normalized.lastIndexOf(',')
  const dot = normalized.lastIndexOf('.')
  let decimalSeparator: ',' | '.' | null = null

  if (comma >= 0 && dot >= 0) {
    decimalSeparator = comma > dot ? ',' : '.'
  } else if (comma >= 0 || dot >= 0) {
    const separator = comma >= 0 ? ',' : '.'
    const digitsAfter = normalized.length - (comma >= 0 ? comma : dot) - 1
    if (digitsAfter === 1 || digitsAfter === 2) decimalSeparator = separator
  }

  let canonical = normalized
  if (decimalSeparator) {
    const thousandsSeparator = decimalSeparator === ',' ? '.' : ','
    canonical = canonical.split(thousandsSeparator).join('')
    canonical = canonical.replace(decimalSeparator, '.')
  } else {
    canonical = canonical.replace(/[,.]/g, '')
  }
  return Number(canonical)
}

export function parseOcaQuoteResponse(xml: string) {
  if (!xml.trim() || /<fault/i.test(decodeXml(xml))) {
    throw new OcaError('OCA devolvió una respuesta de cotización inválida.')
  }

  const priceText = readXmlValue(xml, ['Precio', 'Importe', 'Valor', 'Total', 'Tarifa', 'Tarifar_Envio_CorporativoResult'])
  const price = priceText === null ? NaN : parseOcaNumber(priceText)
  if (!Number.isFinite(price) || price < 0) {
    throw new OcaError('OCA respondió, pero no pudimos interpretar el importe de la tarifa. Hay que validar el XML real de la cuenta.')
  }

  const hoursText = readXmlValue(xml, ['HorasEntrega'])
  const daysText = readXmlValue(xml, ['DiasEntrega'])
  const hours = hoursText === null ? NaN : parseOcaNumber(hoursText)
  const days = daysText === null ? NaN : parseOcaNumber(daysText)
  const estimatedHours = Number.isFinite(hours) && hours > 0
    ? Math.round(hours)
    : Number.isFinite(days) && days > 0
      ? Math.round(days * 24)
      : null

  return { priceArs: Math.round(price), estimatedHours }
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
  const url = new URL(endpoints[credentials.environment] + '/Tarifar_Envio_Corporativo')
  url.search = new URLSearchParams({
    Cuit: credentials.cuit.slice(0, 2) + '-' + credentials.cuit.slice(2, 10) + '-' + credentials.cuit.slice(10),
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
  if (!response.ok) throw new OcaError('OCA respondió HTTP ' + response.status + ' al cotizar el envío.')
  const parsed = parseOcaQuoteResponse(await response.text())

  return {
    key: 'oca-' + credentials.operative,
    carrierName: 'OCA',
    carrierId: null,
    serviceCode: credentials.operative,
    serviceLabel: 'OCA e-Pak',
    priceArs: parsed.priceArs,
    estimatedHours: parsed.estimatedHours,
  }
}
