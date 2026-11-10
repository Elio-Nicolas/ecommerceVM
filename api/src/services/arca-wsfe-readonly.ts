import { env } from '../config/env'
import { getArcaAccessTicket, type ArcaEnvironment } from './arca-wsaa'

const WSFE_URLS: Record<ArcaEnvironment, string> = {
  HOMOLOGATION: 'https://wswhomo.afip.gov.ar/wsfev1/service.asmx',
  PRODUCTION: 'https://servicios1.afip.gov.ar/wsfev1/service.asmx',
}

const WSFE_NAMESPACE = 'http://ar.gov.afip.dif.FEV1/'

export interface ArcaParameter {
  id: number
  description: string
  [key: string]: string | number
}

export interface ArcaPointOfSale {
  number: number
  emissionType: string
  blocked: boolean
  deactivationDate: string | null
}

export interface ArcaLastAuthorized {
  pointOfSale: number
  voucherType: number
  lastVoucherNumber: number
}

export interface ArcaIvaReceiverCondition {
  id: number
  description: string
  voucherClass: string
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function decodeXml(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

function readTag(xml: string, tag: string): string | null {
  const match = xml.match(new RegExp(`<(?:[\\w.-]+:)?${tag}\\b[^>]*>([\\s\\S]*?)<\\/(?:[\\w.-]+:)?${tag}\\s*>`, 'i'))
  return match ? decodeXml(match[1].trim()) : null
}

function readBlocks(xml: string, tag: string): string[] {
  const matches = xml.matchAll(new RegExp(`<(?:[\\w.-]+:)?${tag}\\b[^>]*>([\\s\\S]*?)<\\/(?:[\\w.-]+:)?${tag}\\s*>`, 'gi'))
  return Array.from(matches, (match) => match[1])
}

function readNumber(xml: string, tag: string): number {
  const value = readTag(xml, tag)
  const parsed = value === null ? Number.NaN : Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`WSFE devolvió un valor inválido en ${tag}`)
  }
  return parsed
}

function readErrors(xml: string): string[] {
  return readBlocks(xml, 'Err').map((block) => {
    const code = readTag(block, 'Code')
    const message = readTag(block, 'Msg')
    return [code ? `código ${code}` : null, message].filter(Boolean).join(': ')
  })
}

function assertWsfeResponse(xml: string, operation: string): void {
  const fault = readTag(xml, 'faultstring')
  if (fault) throw new Error(`WSFE rechazó ${operation}: ${fault}`)

  const errors = readErrors(xml)
  if (errors.length) {
    throw new Error(`WSFE rechazó ${operation}: ${errors.join('; ')}`)
  }

  if (!readTag(xml, `${operation}Result`)) {
    throw new Error(`WSFE devolvió una respuesta inesperada para ${operation}`)
  }
}

async function callWsfe(
  environment: ArcaEnvironment,
  operation: string,
  parameters = '',
): Promise<string> {
  const cuit = env.ARCA_CUIT
  if (!cuit) throw new Error('Falta configurar ARCA_CUIT')

  const ticket = await getArcaAccessTicket(environment)
  const body = [
    `<Auth><Token>${escapeXml(ticket.token)}</Token><Sign>${escapeXml(ticket.sign)}</Sign><Cuit>${cuit}</Cuit></Auth>`,
    parameters,
  ].join('')

  const envelope = [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">',
    '<soap:Header/>',
    '<soap:Body>',
    `<${operation} xmlns="${WSFE_NAMESPACE}">${body}</${operation}>`,
    '</soap:Body>',
    '</soap:Envelope>',
  ].join('')

  const response = await fetch(WSFE_URLS[environment], {
    method: 'POST',
    headers: {
      'content-type': 'text/xml; charset=utf-8',
      SOAPAction: `"${WSFE_NAMESPACE}${operation}"`,
    },
    body: envelope,
    signal: AbortSignal.timeout(20_000),
  })

  const responseXml = await response.text()
  if (!response.ok) throw new Error(`WSFE respondió HTTP ${response.status} en ${operation}`)
  assertWsfeResponse(responseXml, operation)
  return responseXml
}

export async function getArcaPointsOfSale(environment: ArcaEnvironment): Promise<ArcaPointOfSale[]> {
  const xml = await callWsfe(environment, 'FEParamGetPtosVenta')
  const result = readTag(xml, 'FEParamGetPtosVentaResult') ?? ''
  return readBlocks(result, 'PtoVenta').map((block) => {
    const blockedValue = readTag(block, 'Bloqueado')
    return {
      number: readNumber(block, 'Nro'),
      emissionType: readTag(block, 'EmisionTipo') ?? '',
      blocked: blockedValue?.toUpperCase() === 'S',
      deactivationDate: readTag(block, 'FchBaja') || null,
    }
  })
}

export async function getArcaVoucherTypes(environment: ArcaEnvironment): Promise<ArcaParameter[]> {
  const xml = await callWsfe(environment, 'FEParamGetTiposCbte')
  const result = readTag(xml, 'FEParamGetTiposCbteResult') ?? ''
  return readBlocks(result, 'CbteTipo').map((block) => ({
    id: readNumber(block, 'Id'),
    description: readTag(block, 'Desc') ?? '',
    from: readTag(block, 'FchDesde') ?? '',
    to: readTag(block, 'FchHasta') ?? '',
  }))
}

export async function getArcaIvaReceiverConditions(
  environment: ArcaEnvironment,
  voucherClass?: 'A' | 'ALEY' | 'B' | 'C' | '49',
): Promise<ArcaIvaReceiverCondition[]> {
  const parameters = voucherClass
    ? `<ClaseCmp>${escapeXml(voucherClass)}</ClaseCmp>`
    : ''
  const xml = await callWsfe(environment, 'FEParamGetCondicionIvaReceptor', parameters)
  const result = readTag(xml, 'FEParamGetCondicionIvaReceptorResult') ?? ''
  return readBlocks(result, 'CondicionIvaReceptor').map((block) => ({
    id: readNumber(block, 'Id'),
    description: readTag(block, 'Desc') ?? '',
    voucherClass: readTag(block, 'Cmp_Clase') ?? '',
  }))
}

export async function getArcaLastAuthorizedVoucher(
  environment: ArcaEnvironment,
  pointOfSale: number,
  voucherType: number,
): Promise<ArcaLastAuthorized> {
  if (!Number.isInteger(pointOfSale) || pointOfSale < 1 || pointOfSale > 99_999) {
    throw new Error('El punto de venta debe ser un entero entre 1 y 99999')
  }
  if (!Number.isInteger(voucherType) || voucherType < 1) {
    throw new Error('El tipo de comprobante debe ser un entero positivo')
  }

  const parameters = `<PtoVta>${pointOfSale}</PtoVta><CbteTipo>${voucherType}</CbteTipo>`
  const xml = await callWsfe(environment, 'FECompUltimoAutorizado', parameters)
  const result = readTag(xml, 'FECompUltimoAutorizadoResult') ?? ''

  return {
    pointOfSale,
    voucherType,
    lastVoucherNumber: readNumber(result, 'CbteNro'),
  }
}
