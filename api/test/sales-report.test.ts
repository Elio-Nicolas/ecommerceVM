import assert from 'node:assert/strict'
import test from 'node:test'
import { buildSalesReport, getSalesDateRange, type SalesTransaction } from '../src/services/sales-report'

const transaction = (overrides: Partial<SalesTransaction> = {}): SalesTransaction => ({
  id: 'payment-1',
  orderId: 'order-1',
  orderCode: 'TV-001',
  customerName: 'Cliente',
  customerPhone: '2657000000',
  paymentMethod: 'MERCADO_PAGO',
  amountArs: 10000,
  paidAt: new Date('2026-11-23T15:00:00.000Z'),
  orderStatus: 'CONFIRMED',
  deliveryMethod: 'PICKUP',
  refundStatus: 'NONE',
  refundAmountArs: 0,
  providerReference: 'provider-1',
  paymentStatus: 'APPROVED',
  items: [{ productName: 'Parlante', quantity: 1, lineTotalArs: 10000 }],
  ...overrides,
})

test('uses Argentina local day boundaries and rejects invalid ranges', () => {
  const range = getSalesDateRange('2026-11-23', '2026-11-23')
  assert.equal(range.start.toISOString(), '2026-11-23T03:00:00.000Z')
  assert.equal(range.endExclusive.toISOString(), '2026-11-24T03:00:00.000Z')
  assert.throws(() => getSalesDateRange('2026-02-30', '2026-02-30'))
  assert.throws(() => getSalesDateRange('2026-11-24', '2026-11-23'))
  assert.throws(() => getSalesDateRange('2025-01-01', '2026-11-23'))
})

test('groups paid sales by payment method and separates full from partial refunds', () => {
  const report = buildSalesReport([
    transaction(),
    transaction({ id: 'payment-2', orderId: 'order-2', paymentMethod: 'GOCUOTAS', amountArs: 8000, refundStatus: 'FULL', refundAmountArs: 8000 }),
    transaction({ id: 'payment-3', orderId: 'order-3', paymentMethod: 'CASH', amountArs: 5000, refundStatus: 'PARTIAL' }),
  ])
  assert.equal(report.summary.grossCollectedArs, 23000)
  assert.equal(report.summary.fullyRefundedArs, 8000)
  assert.equal(report.summary.netAfterFullRefundsArs, 15000)
  assert.equal(report.summary.orders, 3)
  assert.equal(report.summary.partialRefunds, 1)
  assert.equal(report.byPaymentMethod.find((item) => item.paymentMethod === 'GOCUOTAS')?.fullyRefundedArs, 8000)
  assert.equal(report.byDay[0].totalArs, 23000)
})
