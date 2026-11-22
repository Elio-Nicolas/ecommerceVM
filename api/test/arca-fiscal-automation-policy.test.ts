import assert from 'node:assert/strict'
import test from 'node:test'
import { decideFiscalAutomation, type FiscalAutomationInput } from '../src/services/arca-fiscal-automation-policy'

const base: FiscalAutomationInput = {
  paymentStatus: 'APPROVED',
  orderStatus: 'CONFIRMED',
  cancellationStatus: null,
  returnStatus: 'NOT_REQUIRED',
  invoiceStatus: null,
  invoiceTotalArs: 10000,
  refundedAmountArs: 0,
  existingCreditNoteAmountArs: 0,
  refundProviderConfirmed: false,
}

test('no factura antes de que el pago esté realmente aprobado', () => {
  for (const paymentStatus of ['CREATING', 'PENDING', 'UNKNOWN', 'REJECTED', 'CANCELLED'] as const) {
    assert.equal(decideFiscalAutomation({ ...base, paymentStatus }), 'WAIT_PAYMENT', paymentStatus)
  }
})

test('emite una única Factura C cuando el pago está aprobado y el pedido confirmado', () => {
  assert.equal(decideFiscalAutomation(base), 'ISSUE_INVOICE')
})

test('un pago aprobado no factura un pedido cancelado sin resolver el dinero', () => {
  assert.equal(decideFiscalAutomation({ ...base, orderStatus: 'CANCELLED' }), 'HOLD_CANCELLED_ORDER')
})

test('una solicitud de arrepentimiento abierta bloquea una factura nueva', () => {
  for (const cancellationStatus of ['REQUESTED', 'PROCESSING'] as const) {
    assert.equal(decideFiscalAutomation({ ...base, cancellationStatus }), 'HOLD_CANCEL_REQUEST')
  }
})

test('un documento pendiente, emitiéndose o incierto siempre se concilia; nunca se duplica', () => {
  for (const invoiceStatus of ['PENDING', 'ISSUING', 'UNKNOWN'] as const) {
    assert.equal(decideFiscalAutomation({ ...base, invoiceStatus }), 'RECONCILE_INVOICE')
  }
})

test('una factura rechazada requiere conciliar numeración antes de un nuevo intento', () => {
  assert.equal(decideFiscalAutomation({ ...base, invoiceStatus: 'REJECTED' }), 'RECONCILE_INVOICE')
})

test('una factura ya autorizada no se vuelve a emitir', () => {
  assert.equal(decideFiscalAutomation({ ...base, invoiceStatus: 'AUTHORIZED' }), 'NOOP_INVOICE_EXISTS')
})

test('un reintegro informado pero no confirmado por el proveedor no genera nota de crédito', () => {
  assert.equal(decideFiscalAutomation({
    ...base, invoiceStatus: 'AUTHORIZED', refundedAmountArs: 10000,
    paymentStatus: 'APPROVED', refundProviderConfirmed: false,
  }), 'WAIT_REFUND')
})

test('un reintegro total confirmado antes del despacho genera Nota de Crédito C total', () => {
  assert.equal(decideFiscalAutomation({
    ...base, invoiceStatus: 'AUTHORIZED', paymentStatus: 'REFUNDED',
    refundedAmountArs: 10000, refundProviderConfirmed: true,
  }), 'ISSUE_FULL_CREDIT_NOTE')
})

test('un reintegro parcial confirmado genera Nota de Crédito C parcial', () => {
  assert.equal(decideFiscalAutomation({
    ...base, invoiceStatus: 'AUTHORIZED', paymentStatus: 'PARTIALLY_REFUNDED',
    refundedAmountArs: 2500, refundProviderConfirmed: true,
  }), 'ISSUE_PARTIAL_CREDIT_NOTE')
})

test('una Nota de Crédito ya emitida por el importe reintegrado no se duplica', () => {
  assert.equal(decideFiscalAutomation({
    ...base, invoiceStatus: 'AUTHORIZED', paymentStatus: 'REFUNDED',
    refundedAmountArs: 10000, existingCreditNoteAmountArs: 10000,
    refundProviderConfirmed: true,
  }), 'NOOP_CREDIT_NOTE_EXISTS')
})

test('un reintegro superior al importe facturado queda bloqueado para conciliación', () => {
  assert.equal(decideFiscalAutomation({
    ...base, invoiceStatus: 'AUTHORIZED', paymentStatus: 'REFUNDED',
    refundedAmountArs: 11000, refundProviderConfirmed: true,
  }), 'RECONCILE_REFUND')
})

test('una devolución física pendiente después del despacho requiere inspección antes de la nota', () => {
  assert.equal(decideFiscalAutomation({
    ...base, orderStatus: 'SHIPPED', returnStatus: 'RETURN_PENDING',
    invoiceStatus: 'AUTHORIZED', paymentStatus: 'REFUNDED',
    refundedAmountArs: 10000, refundProviderConfirmed: true,
  }), 'HOLD_RETURN_INSPECTION')
})

test('la recepción sin aceptación de la devolución no permite reponer stock ni cerrar la nota', () => {
  assert.equal(decideFiscalAutomation({
    ...base, orderStatus: 'DELIVERED', returnStatus: 'RETURN_RECEIVED',
    invoiceStatus: 'AUTHORIZED', paymentStatus: 'REFUNDED',
    refundedAmountArs: 10000, refundProviderConfirmed: true,
  }), 'HOLD_RETURN_INSPECTION')
})

test('una devolución aceptada permite emitir la nota de crédito tras el reintegro confirmado', () => {
  assert.equal(decideFiscalAutomation({
    ...base, orderStatus: 'DELIVERED', returnStatus: 'RETURN_ACCEPTED',
    invoiceStatus: 'AUTHORIZED', paymentStatus: 'REFUNDED',
    refundedAmountArs: 10000, refundProviderConfirmed: true,
  }), 'ISSUE_FULL_CREDIT_NOTE')
})

test('si el pedido se cancela y reintegra antes de emitir factura no se genera documento fiscal', () => {
  assert.equal(decideFiscalAutomation({
    ...base, orderStatus: 'CANCELLED', paymentStatus: 'REFUNDED',
    refundedAmountArs: 10000, refundProviderConfirmed: true,
  }), 'NO_FISCAL_DOCUMENT_REQUIRED')
})

test('efectivo no cobrado no se factura; efectivo recibido se representa como pago aprobado', () => {
  assert.equal(decideFiscalAutomation({ ...base, paymentStatus: 'PENDING' }), 'WAIT_PAYMENT')
  assert.equal(decideFiscalAutomation({ ...base, paymentStatus: 'APPROVED' }), 'ISSUE_INVOICE')
})

test('una factura existente con reintegro sin importe o inconsistente requiere revisión', () => {
  assert.equal(decideFiscalAutomation({
    ...base, invoiceStatus: 'AUTHORIZED', paymentStatus: 'REFUNDED',
    refundedAmountArs: 10000, invoiceTotalArs: 0, refundProviderConfirmed: true,
  }), 'RECONCILE_REFUND')
})

test('la aprobación tardía de un pedido cancelado no dispara facturación automática', () => {
  assert.equal(decideFiscalAutomation({
    ...base, orderStatus: 'CANCELLED', paymentStatus: 'APPROVED',
  }), 'HOLD_CANCELLED_ORDER')
})

test('el reintegro confirmado sin factura previa no necesita una nota de crédito', () => {
  assert.equal(decideFiscalAutomation({
    ...base, paymentStatus: 'REFUNDED', refundedAmountArs: 10000,
    refundProviderConfirmed: true,
  }), 'NO_FISCAL_DOCUMENT_REQUIRED')
})
