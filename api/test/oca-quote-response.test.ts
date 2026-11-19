import assert from 'node:assert/strict'
import testCase from 'node:test'
import { OcaError, parseOcaQuoteResponse } from '../src/services/oca'

testCase('interpreta una tarifa OCA con formato decimal argentino', () => {
  assert.deepEqual(
    parseOcaQuoteResponse('<Respuesta><Precio>$ 1.234,56</Precio><DiasEntrega>3</DiasEntrega></Respuesta>'),
    { priceArs: 1235, estimatedHours: 72 },
  )
})

testCase('interpreta una tarifa OCA con formato decimal internacional y namespace', () => {
  assert.deepEqual(
    parseOcaQuoteResponse('<oca:Respuesta xmlns:oca="urn:oca"><oca:Importe>1234.50</oca:Importe><oca:HorasEntrega>48</oca:HorasEntrega></oca:Respuesta>'),
    { priceArs: 1235, estimatedHours: 48 },
  )
})

testCase('interpreta XML interno escapado por el servicio SOAP/ASMX', () => {
  assert.deepEqual(
    parseOcaQuoteResponse('<string>&lt;Respuesta&gt;&lt;Total&gt;1.234,00&lt;/Total&gt;&lt;/Respuesta&gt;</string>'),
    { priceArs: 1234, estimatedHours: null },
  )
})

testCase('rechaza respuestas sin importe interpretable', () => {
  assert.throws(
    () => parseOcaQuoteResponse('<Respuesta><Mensaje>Operativa inválida</Mensaje></Respuesta>'),
    OcaError,
  )
})

testCase('no inventa un plazo cuando OCA no informa horas o días', () => {
  assert.deepEqual(
    parseOcaQuoteResponse('<Respuesta><Precio>2500</Precio><PlazoEntrega>3</PlazoEntrega></Respuesta>'),
    { priceArs: 2500, estimatedHours: null },
  )
})
