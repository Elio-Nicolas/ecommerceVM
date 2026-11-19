import { getStoredOcaCredentials } from './shipping-settings'

export class OcaMetadataError extends Error {
  constructor(message: string, readonly statusCode = 502) {
    super(message)
    this.name = 'OcaMetadataError'
  }
}

const endpoints = {
  QA: {
    costCenters: 'https://integraciones.ocadev.com.ar/epak_tracking_test/GetCentroCostoPorOperativa',
  },
  PRODUCTION: {
    costCenters: 'https://webservice.oca.com.ar/oep_tracking/Oep_Track.asmx/GetCentroCostoPorOperativa',
  },
} as const

function decodeXml(value: string): string {
  let decoded = value
  for (let index = 0; index < 2; index += 1) {
    decoded = decoded.replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"').replace(/&apos;/gi, "'").replace(/&amp;/gi, '&')
  }
  return decoded
}

function readTag(xml: string, names: string[]): string | null {
  for (const name of names) {
    const escaped = name.replace(/[.*+?^${}()|[\\]\\]/g, '\\name.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')')
    const match = xml.match(new RegExp('<(?:[\\w.-]+:)?' + escaped + '(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:[\\w.-]+:)?' + escaped + '\\s*>', 'i'))
    if (match?.[1]) return match[1].replace(/<[^>]+>/g, '').trim()
  }
  return null
}

function parseRows(xml: string): string[] {
  const decoded = decodeXml(xml)
  const rows = [...decoded.matchAll(/<(?:[\\w.-]+:)?Table(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:[\\w.-]+:)?Table\\s*>/gi)]
  if (rows.length) return rows.map((row) => row[1])
  if (/<(?:[\\w.-]+:)?NewDataSet\\b/i.test(decoded)) return []
  throw new OcaMetadataError('OCA devolvió un XML de centros de costo con una estructura no reconocida.')
}

export type OcaCostCenter = {
  number: string
  requester: string | null
  locality: string | null
  postalCode: string | null
}

export function parseOcaCostCenters(xml: string): OcaCostCenter[] {
  if (!xml.trim() || /<(?:[\\w.-]+:)?Fault\\b/i.test(decodeXml(xml))) {
    throw new OcaMetadataError('OCA devolvió una respuesta inválida al consultar centros de costo.')
  }
  const centers = parseRows(xml).map((row) => ({
    number: readTag(row, ['NroCentroCosto']) ?? '',
    requester: readTag(row, ['Solicitante']),
    locality: readTag(row, ['LocalidadRetiro']),
    postalCode: readTag(row, ['codigopostal', 'CodigoPostal']),
  })).filter((center) => /^\\d{1,10}$/.test(center.number))
  return centers
}

export async function getOcaCostCenters(): Promise<OcaCostCenter[]> {
  const credentials = await getStoredOcaCredentials()
  if (!credentials) throw new OcaMetadataError('Configurá primero usuario e-Pak, contraseña, CUIT y operativa OCA.', 503)
  const url = new URL(endpoints[credentials.environment].costCenters)
  url.search = new URLSearchParams({
    CUIT: credentials.cuit.slice(0, 2) + '-' + credentials.cuit.slice(2, 10) + '-' + credentials.cuit.slice(10),
    Operativa: credentials.operative,
  }).toString()

  let response: Response
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(15000) })
  } catch {
    throw new OcaMetadataError('No se pudo conectar con OCA para consultar los centros de costo.')
  }
  if (!response.ok) throw new OcaMetadataError('OCA respondió HTTP ' + response.status + ' al consultar centros de costo.')
  const centers = parseOcaCostCenters(await response.text())
  if (!centers.length) throw new OcaMetadataError('OCA no devolvió centros de costo para la CUIT y operativa configuradas.')
  return centers
}
