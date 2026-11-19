import { getStoredOcaCredentials } from './shipping-settings'

export class OcaAdmissionError extends Error {
  constructor(message: string, readonly statusCode = 502, readonly uncertain = false) {
    super(message)
    this.name = 'OcaAdmissionError'
  }
}

const endpoints = {
  QA: 'https://integraciones.ocadev.com.ar/epak_tracking_test/Oep_TrackEPak.asmx',
  PRODUCTION: 'https://webservice.oca.com.ar/ePak_tracking/Oep_TrackEPak.asmx',
} as const

function decodeXml(value: string): string {
  let decoded = value
  for (let index = 0; index < 2; index += 1) {
    decoded = decoded
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&apos;/gi, "'")
      .replace(/&amp;/gi, '&')
  }
  return decoded
}

function xmlTag(xml: string, names: string[]): string | null {
  for (const name of names) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const match = xml.match(new RegExp('<(?:[\\w.-]+:)?' + escaped + '(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:[\\w.-]+:)?' + escaped + '\\s*>', 'i'))
    if (match?.[1]) return match[1].replace(/<[^>]+>/g, '').trim()
  }
  return null
}

function integerTag(xml: string, names: string[]): number | null {
  const value = xmlTag(xml, names)
  if (value === null || !/^\d+$/.test(value)) return null
  return Number(value)
}

export type OcaAdmissionResult = {
  admissionId: string
  trackingNumber: string | null
  remittance: string | null
  providerStatus: string | null
  acceptedCount: number
  rejectedCount: number
  operationCode: string | null
}

export function parseOcaAdmissionResponse(responseXml: string): OcaAdmissionResult {
  const xml = decodeXml(responseXml)
  if (!xml.trim()) {
    throw new OcaAdmissionError(
      'OCA no devolvió contenido luego de recibir la solicitud. El resultado puede ser incierto: verificá e-Pak antes de reintentar.',
      502,
      true,
    )
  }
  if (/<(?:[\\w.-]+:)?Fault\\b/i.test(xml)) {
    throw new OcaAdmissionError('OCA rechazó la solicitud mediante un SOAP Fault.')
  }

  const detailMatch = xml.match(/<(?:[\w.-]+:)?DetalleIngresos(?:\s[^>]*)?>([\s\S]*?)<\/(?:[\w.-]+:)?DetalleIngresos\s*>/i)
  const summaryMatch = xml.match(/<(?:[\w.-]+:)?Resumen(?:\s[^>]*)?>([\s\S]*?)<\/(?:[\w.-]+:)?Resumen\s*>/i)
  const detail = detailMatch?.[1] ?? ''
  const summary = summaryMatch?.[1] ?? ''
  const admissionId = xmlTag(detail, ['OrdenRetiro'])
  const trackingNumber = xmlTag(detail, ['NumeroEnvio'])
  const acceptedCount = integerTag(summary, ['CantidadIngresados'])
  const rejectedCount = integerTag(summary, ['CantidadRechazados'])
  const operationCode = xmlTag(summary, ['CodigoOperacion'])

  if (acceptedCount === null || rejectedCount === null || !admissionId) {
    throw new OcaAdmissionError(
      'OCA respondió sin un resultado de admisión concluyente. No reintentes a ciegas: verificá la orden en e-Pak antes de volver a enviarla.',
      502,
      true,
    )
  }
  if (acceptedCount < 1 || rejectedCount > 0) {
    const providerMessage = xmlTag(detail, ['Mensaje', 'Descripcion', 'Error']) || xmlTag(summary, ['Mensaje', 'Descripcion'])
    throw new OcaAdmissionError(
      providerMessage
        ? 'OCA no admitió el envío: ' + providerMessage
        : 'OCA informó que el envío fue rechazado. Revisá el detalle en e-Pak.',
      422,
    )
  }

  return {
    admissionId,
    trackingNumber: trackingNumber || null,
    remittance: xmlTag(detail, ['Remito']),
    providerStatus: xmlTag(detail, ['Estado']),
    acceptedCount,
    rejectedCount,
    operationCode,
  }
}

/**
 * Creates one OCA admission using the published e-Pak HTTP POST contract.
 * Immediate confirmation is deliberately opt-in; false leaves the order in
 * the e-Pak cart for an operator to confirm there.
 */
export async function createOcaAdmission(input: {
  xmlData: string
  confirmImmediately?: boolean
  requiredEnvironment?: keyof typeof endpoints
}): Promise<OcaAdmissionResult> {
  const credentials = await getStoredOcaCredentials()
  if (!credentials) throw new OcaAdmissionError('OCA todavía no está configurado.', 503)
  if (input.requiredEnvironment && credentials.environment !== input.requiredEnvironment) {
    throw new OcaAdmissionError('El ambiente OCA cambió o no coincide con el ambiente autorizado para esta operación.', 409)
  }
  if (!input.xmlData.trim() || input.xmlData.length > 100_000) {
    throw new OcaAdmissionError('Los datos XML de admisión están vacíos o superan el tamaño permitido.', 400)
  }

  const url = endpoints[credentials.environment] + '/IngresoORMultiplesRetiros_v2'
  const body = new URLSearchParams({
    usr: credentials.username,
    psw: credentials.password,
    xml_Datos: input.xmlData,
    ConfirmarRetiro: input.confirmImmediately === true ? 'true' : 'false',
    ArchivoCliente: '',
    ArchivoProceso: '',
    compatMode: '',
  })

  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8' },
      body,
      signal: AbortSignal.timeout(25000),
    })
  } catch {
    throw new OcaAdmissionError(
      'Se interrumpió la comunicación con OCA durante la admisión. El resultado puede ser incierto: consultá e-Pak antes de reintentar.',
      502,
      true,
    )
  }
  if (!response.ok) {
    throw new OcaAdmissionError(
      'OCA respondió HTTP ' + response.status + ' al registrar el envío. Verificá e-Pak antes de reintentar.',
      502,
      true,
    )
  }
  let responseXml: string
  try {
    responseXml = await response.text()
  } catch {
    throw new OcaAdmissionError(
      'Se interrumpió la lectura de la respuesta de OCA. El resultado puede ser incierto: consultá e-Pak antes de reintentar.',
      502,
      true,
    )
  }
  return parseOcaAdmissionResponse(responseXml)
}
