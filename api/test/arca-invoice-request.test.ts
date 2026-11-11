import assert from 'node:assert/strict'
import test from 'node:test'
import { matchesArcaInvoiceRequest } from '../src/services/arca-invoice-request'

test('permite reintentar idempotentemente la misma factura del mismo pedido', () => {
  assert.equal(matchesArcaInvoiceRequest({ orderId: 'order-1', type: 'INVOICE_C' }, 'order-1'), true)
})

test('rechaza reutilizar la clave de factura para otro pedido', () => {
  assert.equal(matchesArcaInvoiceRequest({ orderId: 'order-1', type: 'INVOICE_C' }, 'order-2'), false)
})

test('rechaza reutilizar la clave de una nota de crédito o débito como factura', () => {
  assert.equal(matchesArcaInvoiceRequest({ orderId: 'order-1', type: 'CREDIT_NOTE_C' }, 'order-1'), false)
  assert.equal(matchesArcaInvoiceRequest({ orderId: 'order-1', type: 'DEBIT_NOTE_C' }, 'order-1'), false)
})
