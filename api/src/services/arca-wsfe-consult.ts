import { env } from '../config/env'
import { getArcaAccessTicket, type ArcaEnvironment } from './arca-wsaa'

const WSFE_URLS: Record<ArcaEnvironment, string> = {
  HOMOLOGATION: 'https://wswhomo.afip.gov.ar/wsfev1/service.asmx',
  PRODUCTION: 'https://servicios1.afip.gov.ar/wsfev1/service.asmx',
}
const WSFE_NAMESPACE = 'http://ar.gov.afip.dif.FEV1/'

export interface ArcaVoucherLookup {
  outcome: 'AUTHORIZED' | 'NOT_FOUND' | 'UNKNOWN'
  cae: string | null
  caeExpiresAt: Date | null
  responsePayload: Record<string, unknown>
  message: string
}

function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
}

function decodeXml(value: string): string {
  return value.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
}

function readTag(xml: string, tag: string): string | null {
  const match = xml.match(new RegExp(`<(?:[\\w.-]+:)?${tag}\\b[^>]*>([\\s\\S]*?)<\\/(?:[\\w.-]+:)?${tag}\\s*>`, 'i'))
  return match ? decodeXml(match[1].trim()) : null
}

function readBlocks(xml: string, tag: string): string[] {
  const matches = xml.matchAll(new RegExp(`<(?:[\\w.-]+:)?${tag}\\b[^>]*>([\\s\\S]*?)<\\/(?:[\\w.-]+:)?${tag}\\s*>`, 'gi'))
  return Array.from(matches, (match) => match[1])
}

function parseArcaDate(value: string | null): Date | null {
  if (!value || !/^\\d{8}$/.test(value)) return null
  return new Date(`${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T00:00:00-03:00`)
}

export async function consultArcaVoucher(
  environment: ArcaEnvironment,
  input: { pointOfSale: number; voucherType: number; voucherNumber: number },
): Promise<ArcaVoucherLookup> {
  const cuit = env.ARCA_CUIT
  if (!cuit) throw new Error('Falta configurar ARCA_CUIT')
  const ticket = await getArcaAccessTicket(environment)
  const xml = [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">',
    '<soap:Header/><soap:Body>',
    `<FECompConsultar xmlns="${WSFE_NAMESPACE}">`,
    `<Auth><Token>${escapeXml(ticket.token)}</Token><Sign>${escapeXml(ticket.sign)}</Sign><Cuit>${cuit}</Cuit></Auth>`,
    `<FeCompConsReq><CbteTipo>${input.voucherType}</CbteTipo><CbteNro>${input.voucherNumber}</CbteNro><PtoVta>${input.pointOfSale}</PtoVta></FeCompConsReq>`,
    '</FECompConsultar></soap:Body></soap:Envelope>',
  ].join('')

  const response = await fetch(WSFE_URLS[environment], {
    method: 'POST',
    headers: {
      'content-type': 'text/xml; charset=utf-8',
      SOAPAction: `"${WSFE_NAMESPACE}FECompConsultar"`,
    },
    body: xml,
    signal: AbortSignal.timeout(20_000),
  })
  const responseXml = await response.text()
  const fault = readTag(responseXml, 'faultstring')
  if (fault) throw new Error(`ARCA devolvió un error SOAP: ${fault}`)
  if (!response.ok) throw new Error(`ARCA respondió HTTP ${response.status} al consultar el comprobante.`)

  const result = readTag(responseXml, 'FECompConsultarResult')
  if (!result) throw new Error('ARCA devolvió una respuesta incompleta al consultar el comprobante.')

  const errors = readBlocks(result, 'Err').map((block) => ({
    code: readTag(block, 'Code'),
    message: readTag(block, 'Msg'),
  }))
  const resultGet = readTag(result, 'ResultGet')
  if (!resultGet && errors.length === 1 && errors[0].code === '602') {
    return {
      outcome: 'NOT_FOUND',
      cae: null,
      caeExpiresAt: null,
      responsePayload: { errors },
      message: 'ARCA confirmó que no existe un comprobante con ese punto de venta, tipo y número.',
    }
  }
  if (errors.length) {
    throw new Error(`ARCA no pudo confirmar el comprobante: ${errors.map((error) => [error.code, error.message].filter(Boolean).join(' ')).join('; ')}`)
  }
  if (!resultGet) throw new Error('ARCA no devolvió datos del comprobante; el resultado sigue siendo ambiguo.')

  const outcome = readTag(resultGet, 'Resultado')
  const cae = readTag(resultGet, 'CodAutorizacion') ?? readTag(resultGet, 'CAE')
  const caeExpiresAt = parseArcaDate(readTag(resultGet, 'FchVto') ?? readTag(resultGet, 'CAEFchVto'))
  const responsePayload = {
    outcome,
    cae,
    caeExpiresAt: caeExpiresAt?.toISOString() ?? null,
    voucherDate: readTag(resultGet, 'CbteFch'),
    voucherType: readTag(resultGet, 'CbteTipo'),
    pointOfSale: readTag(resultGet, 'PtoVta'),
    voucherNumber: readTag(resultGet, 'CbteDesde'),
  }

  if (outcome === 'A' && cae && /^\\d{14}$/.test(cae) && caeExpiresAt) {
    return {
      outcome: 'AUTHORIZED',
      cae,
      caeExpiresAt,
      responsePayload,
      message: 'ARCA confirmó que el comprobante está autorizado. Se recuperó el CAE.',
    }
  }
  throw new Error('ARCA devolvió el comprobante sin un resultado de autorización y CAE verificables.')
}
