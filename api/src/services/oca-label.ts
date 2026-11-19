import { getStoredOcaCredentials } from './shipping-settings'

export class OcaLabelError extends Error {
  constructor(message: string, readonly statusCode = 502) {
    super(message)
    this.name = 'OcaLabelError'
  }
}

const endpoints = {
  QA: 'https://integraciones.ocadev.com.ar/epak_tracking_test/Oep_TrackEPak.asmx',
  PRODUCTION: 'https://webservice.oca.com.ar/ePak_tracking/Oep_TrackEPak.asmx',
} as const

function decodeXml(value: string): string {
  return value
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&amp;/gi, '&')
}

export function parseOcaLabelPdfResponse(xml: string): Buffer {
  if (!xml.trim() || /<fault/i.test(decodeXml(xml))) {
    throw new OcaLabelError('OCA devolvió una respuesta inválida al solicitar la etiqueta.')
  }

  const decoded = decodeXml(xml)
  const match = decoded.match(/<(?:[\w.-]+:)?(?:string|GetPdfDeEtiquetasPorOrdenOrNumeroEnvioResult)(?:\s[^>]*)?>([\s\S]*?)<\/(?:[\w.-]+:)?(?:string|GetPdfDeEtiquetasPorOrdenOrNumeroEnvioResult)\s*>/i)
  const encoded = match?.[1]?.replace(/<!\[CDATA\[|\]\]>/g, '').replace(/\s+/g, '').trim()
  if (!encoded || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
    throw new OcaLabelError('OCA no devolvió una etiqueta PDF en Base64.')
  }

  const pdf = Buffer.from(encoded, 'base64')
  if (pdf.length < 8 || pdf.length > 15 * 1024 * 1024 || pdf.subarray(0, 5).toString('ascii') !== '%PDF-') {
    throw new OcaLabelError('La etiqueta recibida de OCA no es un PDF válido o supera el tamaño permitido.')
  }
  return pdf
}

export async function getOcaLabelPdf(input: { admissionId: string; trackingNumber?: string | null }): Promise<Buffer> {
  const credentials = await getStoredOcaCredentials()
  if (!credentials) throw new OcaLabelError('OCA todavía no está configurado.', 503)
  const admissionId = input.admissionId.trim()
  if (!admissionId || admissionId.length > 80) throw new OcaLabelError('El identificador de admisión OCA no es válido.', 400)

  const url = new URL(endpoints[credentials.environment] + '/GetPdfDeEtiquetasPorOrdenOrNumeroEnvio')
  url.search = new URLSearchParams({
    idOrdenRetiro: admissionId,
    nroEnvio: input.trackingNumber?.trim() || '',
    logisticaInversa: 'false',
  }).toString()

  let response: Response
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(20000) })
  } catch {
    throw new OcaLabelError('No se pudo conectar con OCA para recuperar la etiqueta.')
  }
  if (!response.ok) throw new OcaLabelError('OCA respondió HTTP ' + response.status + ' al solicitar la etiqueta.')
  return parseOcaLabelPdfResponse(await response.text())
}
