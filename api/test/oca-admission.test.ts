import assert from 'node:assert/strict'
import testCase from 'node:test'
import { parseOcaAdmissionResponse, OcaAdmissionError } from '../src/services/oca-admission'

const accepted = `<?xml version="1.0"?><DataSet><Resultado><DetalleIngresos><Operativa>78254</Operativa><OrdenRetiro>12345678</OrdenRetiro><NumeroEnvio>3626000000000209484</NumeroEnvio><Remito>EV-TEST-1</Remito><Estado>Ingresado</Estado></DetalleIngresos><Resumen><CodigoOperacion>100</CodigoOperacion><CantidadRegistros>1</CantidadRegistros><CantidadIngresados>1</CantidadIngresados><CantidadRechazados>0</CantidadRechazados></Resumen></Resultado></DataSet>`

testCase('interpreta admisión aceptada, orden de retiro y tracking', () => {
  assert.deepEqual(parseOcaAdmissionResponse(accepted), {
    admissionId: '12345678',
    trackingNumber: '3626000000000209484',
    remittance: 'EV-TEST-1',
    providerStatus: 'Ingresado',
    acceptedCount: 1,
    rejectedCount: 0,
    operationCode: '100',
  })
})

testCase('interpreta respuesta XML escapada por ASMX', () => {
  const escaped = accepted.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  assert.equal(parseOcaAdmissionResponse(escaped).admissionId, '12345678')
})

testCase('rechaza resultado con registros rechazados', () => {
  const rejected = accepted
    .replace('<OrdenRetiro>12345678</OrdenRetiro>', '<OrdenRetiro>12345678</OrdenRetiro><Mensaje>Operativa no habilitada</Mensaje>')
    .replace('<CantidadIngresados>1</CantidadIngresados>', '<CantidadIngresados>0</CantidadIngresados>')
    .replace('<CantidadRechazados>0</CantidadRechazados>', '<CantidadRechazados>1</CantidadRechazados>')
  assert.throws(() => parseOcaAdmissionResponse(rejected), /Operativa no habilitada/)
})

testCase('marca respuesta incompleta como incierta para impedir reintentos ciegos', () => {
  assert.throws(
    () => parseOcaAdmissionResponse('<DataSet><Resultado><Resumen><CantidadIngresados>1</CantidadIngresados></Resumen></Resultado></DataSet>'),
    (error: unknown) => error instanceof OcaAdmissionError && error.uncertain,
  )
})

testCase('rechaza SOAP Fault', () => {
  assert.throws(() => parseOcaAdmissionResponse('<soap:Fault>invalid</soap:Fault>'), OcaAdmissionError)
})
