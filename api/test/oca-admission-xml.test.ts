import assert from 'node:assert/strict'
import testCase from 'node:test'
import { buildOcaAdmissionXml, OcaAdmissionXmlError } from '../src/services/oca-admission-xml'

const validInput = {
  accountNumber: '123456/001',
  operative: '78254',
  orderReference: 'EV-ORDER-1001',
  admissionDate: '20261120',
  timeWindowId: 1 as const,
  costCenter: '2',
  originBranchId: '123',
  origin: {
    street: 'San Martin',
    number: '450',
    postalCode: '5730',
    locality: 'Villa Mercedes',
    province: 'San Luis',
  },
  recipient: {
    firstName: 'Juan',
    lastName: 'Perez',
    street: 'Belgrano',
    number: '120',
    postalCode: '1001',
    locality: 'CABA',
    province: 'Buenos Aires',
  },
  parcel: { heightCm: 20, widthCm: 30, lengthCm: 40, weightKg: 2.5 },
}

testCase('genera XML OCA con admisión en sucursal y un único paquete consolidado', () => {
  const xml = buildOcaAdmissionXml(validInput)
  assert.match(xml, /<cabecera ver="2\.0" nrocuenta="123456\/001" origen="API"/)
  assert.match(xml, /idcentroimposicionorigen="123"/)
  assert.match(xml, /idoperativa="78254" nroremito="EV-ORDER-1001"/)
  assert.match(xml, /<paquete alto="20\.00" ancho="30\.00" largo="40\.00" peso="2\.50" valor="0\.00" cant="1"/)
  assert.equal((xml.match(/<paquete\b/g) || []).length, 1)
})

testCase('omite franja horaria para admisión en sucursal y la incluye solo si se informa', () => {
  const xml = buildOcaAdmissionXml({ ...validInput, timeWindowId: undefined })
  assert.doesNotMatch(xml, /idfranjahoraria=/)
  assert.match(buildOcaAdmissionXml(validInput), /idfranjahoraria="1"/)
})

testCase('incluye identificador de sucursal destino solo cuando se elige entrega en sucursal', () => {
  const xml = buildOcaAdmissionXml({
    ...validInput,
    recipient: { ...validInput.recipient, destinationBranchId: '456' },
  })
  assert.match(xml, /idci="456"/)
  assert.doesNotMatch(buildOcaAdmissionXml(validInput), /idci=/)
})

testCase('envía valor declarado solo si la operativa tiene seguro habilitado', () => {
  const xml = buildOcaAdmissionXml({ ...validInput, insuranceEnabled: true, declaredValueArs: 85000 })
  assert.match(xml, /valor="85000\.00"/)
})

testCase('rechaza admisión si falta la sucursal de origen', () => {
  assert.throws(
    () => buildOcaAdmissionXml({ ...validInput, originBranchId: '' }),
    OcaAdmissionXmlError,
  )
})

testCase('rechaza caracteres que OCA advierte que pueden romper el procesamiento XML', () => {
  assert.throws(
    () => buildOcaAdmissionXml({
      ...validInput,
      recipient: { ...validInput.recipient, street: 'Mitre & Sarmiento' },
    }),
    /carácter que OCA no admite/,
  )
})

testCase('rechaza dimensiones o peso inválidos', () => {
  assert.throws(
    () => buildOcaAdmissionXml({ ...validInput, parcel: { ...validInput.parcel, weightKg: 0 } }),
    OcaAdmissionXmlError,
  )
})

testCase('exige valor declarado válido cuando se activa seguro', () => {
  assert.throws(
    () => buildOcaAdmissionXml({ ...validInput, insuranceEnabled: true }),
    OcaAdmissionXmlError,
  )
})
