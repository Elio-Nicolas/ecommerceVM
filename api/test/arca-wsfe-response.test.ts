import assert from 'node:assert/strict'
import test from 'node:test'
import { parseArcaInvoiceCResponse } from '../src/services/arca-wsfe-response'

const envelope = (header: string, detail: string, extra = '') => `<soap:Envelope><soap:Body><FECAESolicitarResponse><FECAESolicitarResult><FeCabResp><Resultado>${header}</Resultado></FeCabResp><FeDetResp><FECAEDetResponse><Resultado>${detail}</Resultado><CAE>74123456789012</CAE><CAEFchVto>20261231</CAEFchVto></FECAEDetResponse></FeDetResp>${extra}</FECAESolicitarResult></FECAESolicitarResponse></soap:Body></soap:Envelope>`

test('reconoce una factura autorizada y conserva CAE y vencimiento', () => {
  const result = parseArcaInvoiceCResponse(envelope('A', 'A'), 200)
  assert.equal(result.outcome, 'AUTHORIZED')
  assert.equal(result.cae, '74123456789012')
  assert.equal(result.caeExpiresAt?.toISOString(), '2026-12-31T03:00:00.000Z')
})

test('reconoce autorización parcial y conserva observaciones decodificadas', () => {
  const xml = envelope('P', 'A', '<FeDetResp><FECAEDetResponse><Obs><Code>100</Code><Msg>Dato &amp; validado</Msg></Obs></FECAEDetResponse></FeDetResp>')
  const result = parseArcaInvoiceCResponse(xml, 200)
  assert.equal(result.outcome, 'AUTHORIZED')
  assert.match(result.message, /\[100\] Dato & validado/)
})

test('reconoce rechazo y expone errores de ARCA', () => {
  const xml = envelope('R', 'R', '<Errors><Err><Code>10016</Code><Msg>Comprobante rechazado</Msg></Err></Errors>')
  const result = parseArcaInvoiceCResponse(xml, 200)
  assert.equal(result.outcome, 'REJECTED')
  assert.match(result.message, /10016/)
  assert.equal(result.cae, null)
})

test('deja en UNKNOWN los faults SOAP y los errores HTTP', () => {
  assert.equal(parseArcaInvoiceCResponse('<soap:Fault><faultstring>Servicio no disponible</faultstring></soap:Fault>', 500).outcome, 'UNKNOWN')
  assert.equal(parseArcaInvoiceCResponse('', 503).outcome, 'UNKNOWN')
})

test('no autoriza respuestas incompletas ni fechas de CAE inválidas', () => {
  assert.equal(parseArcaInvoiceCResponse(envelope('A', 'A').replace('<CAEFchVto>20261231</CAEFchVto>', '<CAEFchVto>20260231</CAEFchVto>'), 200).outcome, 'UNKNOWN')
  assert.equal(parseArcaInvoiceCResponse(envelope('A', 'A').replace('<CAE>74123456789012</CAE>', '<CAE></CAE>'), 200).outcome, 'UNKNOWN')
  assert.equal(parseArcaInvoiceCResponse('<FECAESolicitarResult/>', 200).outcome, 'UNKNOWN')
})
