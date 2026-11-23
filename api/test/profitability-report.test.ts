import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { buildProfitabilityReport } from '../src/services/profitability-report'

describe('buildProfitabilityReport', () => {
  it('calculates margin only for orders with complete costs', () => {
    const report = buildProfitabilityReport([{
      orderId: '1', orderCode: 'EV-1', paidAt: new Date('2026-11-23T12:00:00Z'),
      subtotalArs: 30000, shippingCostArs: 2500, shippingInternalCostArs: 1800,
      deliveryMethod: 'LOCAL_DELIVERY', fullyRefunded: false, partiallyRefunded: false,
      items: [{ productName: 'Parlante', productSku: 'SPK-1', quantity: 2, lineTotalArs: 30000, unitCostArs: 9000 }],
    }, {
      orderId: '2', orderCode: 'EV-2', paidAt: new Date('2026-11-23T13:00:00Z'),
      subtotalArs: 10000, shippingCostArs: 0, shippingInternalCostArs: null,
      deliveryMethod: 'OCA', fullyRefunded: false, partiallyRefunded: false,
      items: [{ productName: 'Auricular', productSku: 'EAR-1', quantity: 1, lineTotalArs: 10000, unitCostArs: null }],
    }])
    assert.equal(report.summary.estimatedGrossMarginArs, 7600)
    assert.equal(report.summary.completeOrders, 1)
    assert.equal(report.summary.incompleteOrders, 1)
    assert.equal(report.summary.marginCoveragePercent, 50)
    assert.equal(report.products.find((item) => item.productSku === 'EAR-1')?.costArs, null)
  })

  it('separates fully refunded orders from recognized revenue', () => {
    const report = buildProfitabilityReport([{
      orderId: '1', orderCode: 'EV-1', paidAt: new Date(),
      subtotalArs: 10000, shippingCostArs: 2000, shippingInternalCostArs: 1000,
      deliveryMethod: 'OCA', fullyRefunded: true, partiallyRefunded: false,
      items: [{ productName: 'Item', productSku: 'I-1', quantity: 1, lineTotalArs: 10000, unitCostArs: 4000 }],
    }])
    assert.equal(report.summary.fullyRefundedArs, 12000)
    assert.equal(report.summary.netRevenueArs, 0)
    assert.equal(report.summary.estimatedGrossMarginArs, 0)
  })
})
