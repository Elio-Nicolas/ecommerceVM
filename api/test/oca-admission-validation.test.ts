import assert from 'node:assert/strict'
import testCase from 'node:test'
import {
  getOcaAdmissionDate,
  isCompleteOcaOriginBranch,
  isOcaOrderPaid,
  matchesOcaRecipient,
} from '../src/services/oca-admission-validation'

const order = {
  customerName: 'Juan Pérez',
  customerPhone: '+54 9 11 1234-5678',
  customerEmail: 'juan@example.com',
  postalCode: '1001',
  city: 'CABA',
  province: 'Buenos Aires',
}
const recipient = {
  firstName: 'Juan',
  lastName: 'Pérez',
  phone: '5491112345678',
  email: 'JUAN@example.com',
  postalCode: '1001',
  locality: ' CABA ',
  province: 'BUENOS AIRES',
}

testCase('considera pago confirmado por recepción manual o intento aprobado', () => {
  assert.equal(isOcaOrderPaid(new Date(), []), true)
  assert.equal(isOcaOrderPaid(null, [{ status: 'APPROVED', approvedAt: new Date() }]), true)
  assert.equal(isOcaOrderPaid(null, [{ status: 'PENDING', approvedAt: null }]), false)
})

testCase('compara identidad y destino normalizando espacios, mayúsculas y teléfono', () => {
  assert.equal(matchesOcaRecipient(order, recipient), true)
  assert.equal(matchesOcaRecipient(order, { ...recipient, postalCode: '1002' }), false)
  assert.equal(matchesOcaRecipient(order, { ...recipient, firstName: 'Pedro' }), false)
  assert.equal(matchesOcaRecipient(order, { ...recipient, phone: '5491199999999' }), false)
})

testCase('exige una sucursal de admisión completa y coincidente', () => {
  const branch = { id: '123', street: 'Mitre', number: '450', postalCode: '5730', locality: 'Villa Mercedes', province: 'San Luis' }
  assert.equal(isCompleteOcaOriginBranch(branch, '123', '5730'), true)
  assert.equal(isCompleteOcaOriginBranch({ ...branch, number: null }, '123', '5730'), false)
  assert.equal(isCompleteOcaOriginBranch(branch, '999', '5730'), false)
})

testCase('calcula fecha de admisión según el día local de Argentina', () => {
  assert.equal(getOcaAdmissionDate(new Date('2026-11-20T02:00:00.000Z')), '20261119')
  assert.equal(getOcaAdmissionDate(new Date('2026-11-20T15:00:00.000Z')), '20261120')
})
