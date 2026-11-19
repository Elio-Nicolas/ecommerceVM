import assert from 'node:assert/strict'
import testCase from 'node:test'
import { parseOcaLabelPdfResponse, OcaLabelError } from '../src/services/oca-label'

const pdf = Buffer.from('%PDF-1.4\nlabel fixture\n%%EOF', 'ascii')
const base64 = pdf.toString('base64')

testCase('decodifica la etiqueta PDF devuelta como string XML', () => {
  const result = parseOcaLabelPdfResponse('<string xmlns="#Oca_e_Pak">' + base64 + '</string>')
  assert.deepEqual(result, pdf)
})

testCase('decodifica resultado SOAP con namespace', () => {
  const result = parseOcaLabelPdfResponse('<soap:Envelope><soap:Body><x:GetPdfDeEtiquetasPorOrdenOrNumeroEnvioResult>' + base64 + '</x:GetPdfDeEtiquetasPorOrdenOrNumeroEnvioResult></soap:Body></soap:Envelope>')
  assert.deepEqual(result, pdf)
})

testCase('acepta XML escapado por ASMX', () => {
  const inner = '<string>' + base64 + '</string>'
  const escaped = inner.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  assert.deepEqual(parseOcaLabelPdfResponse(escaped), pdf)
})

testCase('rechaza respuestas sin PDF o con Base64 inválido', () => {
  assert.throws(() => parseOcaLabelPdfResponse('<string>sin etiqueta</string>'), OcaLabelError)
  assert.throws(() => parseOcaLabelPdfResponse('<string>bm90IGEgcGRm</string>'), /PDF válido/)
})

testCase('rechaza fault SOAP', () => {
  assert.throws(() => parseOcaLabelPdfResponse('<soap:Fault>error</soap:Fault>'), OcaLabelError)
})
