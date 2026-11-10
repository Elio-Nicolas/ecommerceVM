import type { ArcaEnvironment } from './arca-wsaa'
import { env } from '../config/env'
import { getArcaAccessTicket } from './arca-wsaa'

const WSFE_URLS: Record<ArcaEnvironment, string> = {
  HOMOLOGATION: 'https://wswhomo.afip.gov.ar/wsfev1/service.asmx',
  PRODUCTION: 'https://servicios1.afip.gov.ar/wsfev1/service.asmx',
}
const WSFE_NAMESPACE = 'http://ar.gov.afip.dif.FEV1/'

export interface ArcaInvoiceCRequest {
  pointOfSale: number
  voucherNumber: number
  issueDate: Date
  receiverDocumentType: number
  receiverDocumentNumber: string
  receiverVatConditionId: number
  totalAmountArs: number
}

export interface ArcaInvoiceCResult {
  outcome: 'AUTHORIZED' | 'REJECTED' | 'UNKNOWN'
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

function arcaDate(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date)
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${values.year}${values.month}${values.day}`
}

function parseArcaDate(value: string | null): Date | null {
  if (!value || !/^\d{8}$/.test(value)) return null
  return new Date(`${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T00:00:00-03:00`)
}

function readMessages(xml: string, group: 'Err' | 'Obs' | 'Evt'): string[] {
  return readBlocks(xml, group).map((block) => {
    const code = readTag(block, 'Code')
    const message = readTag(block, 'Msg')
    return [code ? `[${code}]` : '', message ?? ''].filter(Boolean).join(' ')
  })
}

export async function requestArcaInvoiceC(
  environment: ArcaEnvironment,
  input: ArcaInvoiceCRequest,
): Promise<ArcaInvoiceCResult> {
  const cuit = env.ARCA_CUIT
  if (!cuit) throw new Error('Falta configurar ARCA_CUIT')
  if (!Number.isSafeInteger(input.totalAmountArs) || input.totalAmountArs <= 0) {
    throw new Error('El importe total de la factura debe ser un entero positivo en pesos.')
  }

  const ticket = await getArcaAccessTicket(environment)
  const request = {
    pointOfSale: input.pointOfSale,
    voucherType: 11,
    voucherNumber: input.voucherNumber,
    issueDate: arcaDate(input.issueDate),
    concept: 1,
    receiverDocumentType: input.receiverDocumentType,
    receiverDocumentNumber: input.receiverDocumentNumber,
    receiverVatConditionId: input.receiverVatConditionId,
    totalAmount: input.totalAmountArs,
    nonTaxedAmount: input.totalAmountArs,
    netAmount: 0,
    exemptAmount: 0,
    vatAmount: 0,
    tributeAmount: 0,
    currency: 'PES',
    currencyRate: 1,
  }

  const xml = [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">',
    '<soap:Header/><soap:Body>',
    `<FECAESolicitar xmlns="${WSFE_NAMESPACE}">`,
    `<Auth><Token>${escapeXml(ticket.token)}</Token><Sign>${escapeXml(ticket.sign)}</Sign><Cuit>${cuit}</Cuit></Auth>`,
    '<FeCAEReq><FeCabReq><CantReg>1</CantReg>',
    `<PtoVta>${request.pointOfSale}</PtoVta><CbteTipo>11</CbteTipo></FeCabReq>`,
    '<FeDetReq><FECAEDetRequest>',
    '<Concepto>1</Concepto>',
    `<DocTipo>${request.receiverDocumentType}</DocTipo><DocNro>${escapeXml(request.receiverDocumentNumber)}</DocNro>`,
    `<CbteDesde>${request.voucherNumber}</CbteDesde><CbteHasta>${request.voucherNumber}</CbteHasta>`,
    `<CbteFch>${request.issueDate}</CbteFch>`,
    `<ImpTotal>${request.totalAmount.toFixed(2)}</ImpTotal><ImpTotConc>${request.nonTaxedAmount.toFixed(2)}</ImpTotConc>`,
    '<ImpNeto>0.00</ImpNeto><ImpOpEx>0.00</ImpOpEx><ImpTrib>0.00</ImpTrib><ImpIVA>0.00</ImpIVA>',
    '<MonId>PES</MonId><MonCotiz>1</MonCotiz>',
    `<CondicionIVAReceptorId>${request.receiverVatConditionId}</CondicionIVAReceptorId>`,
    '</FECAEDetRequest></FeDetReq></FeCAEReq>',
    '</FECAESolicitar></soap:Body></soap:Envelope>',
  ].join('')

  const response = await fetch(WSFE_URLS[environment], {
    method: 'POST',
    headers: {
      'content-type': 'text/xml; charset=utf-8',
      SOAPAction: `"${WSFE_NAMESPACE}FECAESolicitar"`,
    },
    body: xml,
    signal: AbortSignal.timeout(25_000),
  })
  const responseXml = await response.text()
  const fault = readTag(responseXml, 'faultstring')
  if (fault) {
    return {
      outcome: 'UNKNOWN',
      cae: null,
      caeExpiresAt: null,
      responsePayload: { soapFault: fault, httpStatus: response.status },
      message: `ARCA devolvió un error SOAP y no se puede asegurar el resultado: ${fault}`,
    }
  }
  if (!response.ok) {
    return {
      outcome: 'UNKNOWN',
      cae: null,
      caeExpiresAt: null,
      responsePayload: { httpStatus: response.status, responseReceived: Boolean(responseXml) },
      message: `ARCA respondió HTTP ${response.status}; el resultado queda pendiente de conciliación.`,
    }
  }

  const result = readTag(responseXml, 'FECAESolicitarResult') ?? ''
  const header = readTag(result, 'FeCabResp') ?? ''
  const detail = readBlocks(readTag(result, 'FeDetResp') ?? '', 'FECAEDetResponse')[0] ?? ''
  const headerOutcome = readTag(header, 'Resultado')
  const detailOutcome = readTag(detail, 'Resultado')
  const cae = readTag(detail, 'CAE')
  const caeExpiresAt = parseArcaDate(readTag(detail, 'CAEFchVto'))
  const errors = readMessages(result, 'Err')
  const observations = readMessages(result, 'Obs')
  const events = readMessages(result, 'Evt')
  const responsePayload = {
    headerOutcome,
    detailOutcome,
    errors,
    observations,
    events,
    cae,
    caeExpiresAt: caeExpiresAt?.toISOString() ?? null,
  }

  if ((headerOutcome === 'A' || headerOutcome === 'P') && detailOutcome === 'A' && cae && caeExpiresAt) {
    return {
      outcome: 'AUTHORIZED',
      cae,
      caeExpiresAt,
      responsePayload,
      message: observations.length
        ? `Factura C autorizada con observaciones: ${observations.join('; ')}`
        : 'Factura C autorizada por ARCA.',
    }
  }

  if (headerOutcome === 'R' || detailOutcome === 'R') {
    return {
      outcome: 'REJECTED',
      cae: null,
      caeExpiresAt: null,
      responsePayload,
      message: errors.length ? `ARCA rechazó la factura: ${errors.join('; ')}` : 'ARCA rechazó la factura.',
    }
  }

  return {
    outcome: 'UNKNOWN',
    cae: null,
    caeExpiresAt: null,
    responsePayload,
    message: 'ARCA respondió sin una autorización o rechazo concluyente. No vuelvas a emitir hasta conciliar el comprobante.',
  }
}

export function buildArcaInvoiceCRequestPayload(input: ArcaInvoiceCRequest): Record<string, unknown> {
  return {
    voucherType: 11,
    pointOfSale: input.pointOfSale,
    voucherNumber: input.voucherNumber,
    issueDate: arcaDate(input.issueDate),
    concept: 1,
    receiverDocumentType: input.receiverDocumentType,
    receiverDocumentNumber: input.receiverDocumentNumber,
    receiverVatConditionId: input.receiverVatConditionId,
    totalAmount: input.totalAmountArs,
    nonTaxedAmount: input.totalAmountArs,
    netAmount: 0,
    exemptAmount: 0,
    vatAmount: 0,
    tributeAmount: 0,
    currency: 'PES',
    currencyRate: 1,
  }
}
