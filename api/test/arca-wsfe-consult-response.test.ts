import assert from 'node:assert/strict'
import test from 'node:test'
import { parseArcaVoucherConsultResponse } from '../src/services/arca-wsfe-consult-response'

const expected = { pointOfSale: 4, voucherType: 11, voucherNumber: 125 }
const response = (overrides: Record<string, string> = {}) => {
  const values = {
    Resultado: 'A',
    CodAutorizacion: '74123456789012',
    FchVto: '20261231',
    CbteTipo: '11',
    PtoVta: '4',
    CbteDesde: '125',
    CbteFch: '20261201',
    ...overrides,
  }
  const tags = Object.entries(values).map(([tag, value]) => '<' + tag + '>' + value + '</' + tag + '>').join('')
  return '<soap:Envelope><soap:Body><FECompConsultarResponse><FECompConsultarResult><ResultGet>' +
    tags + '</ResultGet></FECompConsultarResult></FECompConsultarResponse></soap:Body></soap:Envelope>'
}

test('recupera una factura autorizada cuando identidad, CAE y vencimiento coinciden', () => {
  const result = parseArcaVoucherConsultResponse(response(), 200, expected)
  assert.equal(result.outcome, 'AUTHORIZED')
  assert.equal(result.cae, '74123456789012')
  assert.equal(result.caeExpiresAt?.toISOString(), '2026-12-31T03:00:00.000Z')
  assert.equal(result.responsePayload.pointOfSale, '4')
})

test('rechaza una respuesta de otro punto de venta, tipo o número', () => {
  for (const overrides of [
    { PtoVta: '5' },
    { CbteTipo: '6' },
    { CbteDesde: '126' },
  ]) {
    assert.throws(
      () => parseArcaVoucherConsultResponse(response(overrides), 200, expected),
      /comprobante distinto/,
    )
  }
})

test('no considera autorizados CAE o vencimientos inválidos', () => {
  assert.throws(
    () => parseArcaVoucherConsultResponse(response({ CodAutorizacion: '123' }), 200, expected),
    /CAE y vencimiento verificables/,
  )
  assert.throws(
    () => parseArcaVoucherConsultResponse(response({ FchVto: '20260231' }), 200, expected),
    /CAE y vencimiento verificables/,
  )
  assert.throws(
    () => parseArcaVoucherConsultResponse(response({ FchVto: 'no-es-fecha' }), 200, expected),
    /CAE y vencimiento verificables/,
  )
})

test('reconoce únicamente el error 602 como comprobante no encontrado', () => {
  const xml = '<FECompConsultarResult><Errors><Err><Code>602</Code><Msg>Comprobante no encontrado</Msg></Err></Errors></FECompConsultarResult>'
  const result = parseArcaVoucherConsultResponse(xml, 200, expected)
  assert.equal(result.outcome, 'NOT_FOUND')
  assert.equal(result.cae, null)
  assert.throws(
    () => parseArcaVoucherConsultResponse(xml.replace('602', '100'), 200, expected),
    /ARCA no pudo confirmar/,
  )
})

test('mantiene como inconclusas las respuestas SOAP, HTTP e incompletas', () => {
  assert.throws(
    () => parseArcaVoucherConsultResponse('<soap:Fault><faultstring>Servicio no disponible</faultstring></soap:Fault>', 500, expected),
    /error SOAP/,
  )
  assert.throws(
    () => parseArcaVoucherConsultResponse('', 503, expected),
    /HTTP 503/,
  )
  assert.throws(
    () => parseArcaVoucherConsultResponse('<Envelope/>', 200, expected),
    /respuesta incompleta/,
  )
  assert.throws(
    () => parseArcaVoucherConsultResponse('<FECompConsultarResult><FeCabResp><Resultado>A</Resultado></FeCabResp></FECompConsultarResult>', 200, expected),
    /resultado sigue siendo ambiguo/,
  )
})
