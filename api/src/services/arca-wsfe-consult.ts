import { env } from '../config/env'
import { getArcaAccessTicket, type ArcaEnvironment } from './arca-wsaa'
import { parseArcaVoucherConsultResponse, type ArcaVoucherLookup } from './arca-wsfe-consult-response'

const WSFE_URLS: Record<ArcaEnvironment, string> = {
  HOMOLOGATION: 'https://wswhomo.afip.gov.ar/wsfev1/service.asmx',
  PRODUCTION: 'https://servicios1.afip.gov.ar/wsfev1/service.asmx',
}
const WSFE_NAMESPACE = 'http://ar.gov.afip.dif.FEV1/'

export type { ArcaVoucherLookup } from './arca-wsfe-consult-response'

function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
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
    \`<FECompConsultar xmlns="\${WSFE_NAMESPACE}">\`,
    \`<Auth><Token>\${escapeXml(ticket.token)}</Token><Sign>\${escapeXml(ticket.sign)}</Sign><Cuit>\${cuit}</Cuit></Auth>\`,
    \`<FeCompConsReq><CbteTipo>\${input.voucherType}</CbteTipo><CbteNro>\${input.voucherNumber}</CbteNro><PtoVta>\${input.pointOfSale}</PtoVta></FeCompConsReq>\`,
    '</FECompConsultar></soap:Body></soap:Envelope>',
  ].join('')

  const response = await fetch(WSFE_URLS[environment], {
    method: 'POST',
    headers: {
      'content-type': 'text/xml; charset=utf-8',
      SOAPAction: \`"\${WSFE_NAMESPACE}FECompConsultar"\`,
    },
    body: xml,
    signal: AbortSignal.timeout(20_000),
  })
  return parseArcaVoucherConsultResponse(await response.text(), response.status, input)
}
