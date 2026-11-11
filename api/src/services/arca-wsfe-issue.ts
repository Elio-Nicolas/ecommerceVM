import type { ArcaEnvironment } from './arca-wsaa'
import { env } from '../config/env'
import { getArcaAccessTicket } from './arca-wsaa'
import { parseArcaInvoiceCResponse, type ArcaInvoiceCResult } from './arca-wsfe-response'

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

function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
}

function arcaDate(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date)
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${values.year}${values.month}${values.day}`
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
    nonTaxedAmount: 0,
    netAmount: input.totalAmountArs,
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
    `<ImpTotal>${request.totalAmount.toFixed(2)}</ImpTotal><ImpTotConc>0.00</ImpTotConc>`,
    `<ImpNeto>${request.netAmount.toFixed(2)}</ImpNeto><ImpOpEx>0.00</ImpOpEx><ImpTrib>0.00</ImpTrib><ImpIVA>0.00</ImpIVA>`,
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
  return parseArcaInvoiceCResponse(responseXml, response.status)
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
    nonTaxedAmount: 0,
    netAmount: input.totalAmountArs,
    exemptAmount: 0,
    vatAmount: 0,
    tributeAmount: 0,
    currency: 'PES',
    currencyRate: 1,
  }
}
