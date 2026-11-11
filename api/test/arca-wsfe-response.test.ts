import assert from 'node:assert/strict'
import test from 'node:test'
import { parseArcaInvoiceCResponse, type ArcaInvoiceCIdentity } from '../src/services/arca-wsfe-response'

const expected: ArcaInvoiceCIdentity = { pointOfSale: 4, voucherType: 11, voucherNumber: 123 }
const envelope = (header: string, detail: string, extra = '') => `<soap:Envelope><soap:Body><FECAESolicitarResponse><FECAESolicitarResult><FeCabResp><Resultado>${header}</Resultado></FeCabResp><FeDetResp><FECAEDetResponse><PtoVta>4</PtoVta><CbteTipo>11</CbteTipo><CbteDesde>123</CbteDesde><CbteHasta>123</CbteHasta><Resultado>${detail}</Resultado><CAE>74123456789012</CAE><CAEFchVto>20261231</CAEFchVto></FECAEDetResponse></FeDetResp>${extra}</FECAESolicitarResult></FECAESolicitarResponse></soap:Body></soap:Envelope>`

test('reconoce una factura autorizada solo para la identidad solicitada', () => {
  const result = parseArcaInvoiceCResponse(envelope('A', 'A'), 200, expected)
  assert.equal(result.outcome, 'AUTHORIZED')
  assert.equal(result.cae, '74123456789012')
  assert.equal(result.caeExpiresAt?.toISOString(), '2026-12-31T03:00:00.000Z')
})

test('reconoce autorización parcial y conserva observaciones decodificadas', () => {
  const xml = envelope('P', 'A', '<FeDetResp><FECAEDetResponse><Obs><Code>100</Code><Msg>Dato &amp; validado</Msg></Obs></FECAEDetResponse></FeDetResp>')
  const result = parseArcaInvoiceCResponse(xml, 200, expected)
  assert.equal(result.outcome, 'AUTHORIZED')
  assert.match(result.message, /\[100\] Dato & validado/)
})

test('reconoce rechazo únicamente cuando la identidad coincide', () => {
  const xml = envelope('R', 'R', '<Errors><Err><Code>10016</Code><Msg>Comprobante rechazado</Msg></Err></Errors>')
  const result = parseArcaInvoiceCResponse(xml, 200, expected)
  assert.equal(result.outcome, 'REJECTED')
  assert.match(result.message, /10016/)
  assert.equal(result.cae, null)
})

test('deja en UNKNOWN los faults SOAP y los errores HTTP', () => {
  assert.equal(parseArcaInvoiceCResponse('<soap:Fault><faultstring>Servicio no disponible</faultstring></soap:Fault>', 500, expected).outcome, 'UNKNOWN')
  assert.equal(parseArcaInvoiceCResponse('', 503, expected).outcome, 'UNKNOWN')
})

test('no autoriza respuestas incompletas, fechas inválidas o CAE malformado', () => {
  assert.equal(parseArcaInvoiceCResponse(envelope('A', 'A').replace('<CAEFchVto>20261231</CAEFchVto>', '<CAEFchVto>20260231</CAEFchVto>'), 200, expected).outcome, 'UNKNOWN')
  assert.equal(parseArcaInvoiceCResponse(envelope('A', 'A').replace('<CAE>74123456789012</CAE>', '<CAE></CAE>'), 200, expected).outcome, 'UNKNOWN')
  assert.equal(parseArcaInvoiceCResponse(envelope('A', 'A').replace('<CAE>74123456789012</CAE>', '<CAE>123</CAE>'), 200, expected).outcome, 'UNKNOWN')
  assert.equal(parseArcaInvoiceCResponse('<FECAESolicitarResult/>', 200, expected).outcome, 'UNKNOWN')
})

test('no acepta una respuesta autorizada para otro punto de venta o comprobante', () => {
  const wrongPoint = envelope('A', 'A').replace('<PtoVta>4</PtoVta>', '<PtoVta>5</PtoVta>')
  const wrongNumber = envelope('A', 'A').replace('<CbteDesde>123</CbteDesde>', '<CbteDesde>124</CbteDesde>').replace('<CbteHasta>123</CbteHasta>', '<CbteHasta>124</CbteHasta>')
  const wrongType = envelope('A', 'A').replace('<CbteTipo>11</CbteTipo>', '<CbteTipo>6</CbteTipo>')
  const missingIdentity = envelope('A', 'A').replace('<PtoVta>4</PtoVta>', '')
  for (const xml of [wrongPoint, wrongNumber, wrongType, missingIdentity]) {
    assert.equal(parseArcaInvoiceCResponse(xml, 200, expected).outcome, 'UNKNOWN')
  }
})

test('no considera concluyente un rango de comprobantes diferente', () => {
  const range = envelope('A', 'A').replace('<CbteHasta>123</CbteHasta>', '<CbteHasta>124</CbteHasta>')
  assert.equal(parseArcaInvoiceCResponse(range, 200, expected).outcome, 'UNKNOWN')
})
