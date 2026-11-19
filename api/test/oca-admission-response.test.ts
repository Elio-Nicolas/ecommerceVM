import assert from 'node:assert/strict'
import testCase from 'node:test'
import { OcaAdmissionError, parseOcaAdmissionResponse } from '../src/services/oca-admission'

const acceptedResponse = `<?xml version="1.0"?>
<IngresoORMultiplesRetiros_v2Response>
  <IngresoORMultiplesRetiros_v2Result>
    <DetalleIngresos><OrdenRetiro>ORD-123</OrdenRetiro><NumeroEnvio>999000111</NumeroEnvio><Remito>REM-123</Remito><Estado>PENDIENTE</Estado></DetalleIngresos>
    <Resumen><CantidadIngresados>1</CantidadIngresados><CantidadRechazados>0</CantidadRechazados><CodigoOperacion>OK</CodigoOperacion></Resumen>
  </IngresoORMultiplesRetiros_v2Result>
</IngresoORMultiplesRetiros_v2Response>`

testCase('interpreta una admisión aceptada con identificador y tracking', () => {
  assert.deepEqual(parseOcaAdmissionResponse(acceptedResponse), {
    admissionId: 'ORD-123',
    trackingNumber: '999000111',
    remittance: 'REM-123',
    providerStatus: 'PENDIENTE',
    acceptedCount: 1,
    rejectedCount: 0,
    operationCode: 'OK',
  })
})

testCase('marca como incierta una respuesta sin identificador de admisión', () => {
  const response = acceptedResponse.replace('<OrdenRetiro>ORD-123</OrdenRetiro>', '')
  assert.throws(
    () => parseOcaAdmissionResponse(response),
    (error: unknown) => error instanceof OcaAdmissionError && error.uncertain,
  )
})

testCase('rechaza una respuesta con paquetes rechazados sin declarar resultado exitoso', () => {
  const response = acceptedResponse.replace('<CantidadRechazados>0</CantidadRechazados>', '<CantidadRechazados>1</CantidadRechazados>')
  assert.throws(
    () => parseOcaAdmissionResponse(response),
    (error: unknown) => error instanceof OcaAdmissionError && !error.uncertain && error.statusCode === 422,
  )
})

testCase('rechaza un SOAP Fault', () => {
  assert.throws(
    () => parseOcaAdmissionResponse('<soap:Fault><faultstring>Rejected</faultstring></soap:Fault>'),
    OcaAdmissionError,
  )
})
