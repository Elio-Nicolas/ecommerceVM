export type ProfitabilityOrder = {
  orderId: string
  orderCode: string
  paidAt: Date
  subtotalArs: number
  shippingCostArs: number | null
  shippingInternalCostArs: number | null
  deliveryMethod: string
  fullyRefunded: boolean
  partiallyRefunded: boolean
  items: Array<{ productName: string; productSku: string; quantity: number; lineTotalArs: number; unitCostArs: number | null }>
}

export function buildProfitabilityReport(orders: ProfitabilityOrder[]) {
  const active = orders.filter((order) => !order.fullyRefunded)
  const refundedOrders = orders.filter((order) => order.fullyRefunded)
  const productRevenueArs = active.reduce((sum, order) => sum + order.subtotalArs, 0)
  const shippingChargedArs = active.reduce((sum, order) => sum + (order.shippingCostArs ?? 0), 0)
  const fullyRefundedArs = refundedOrders.reduce((sum, order) => sum + order.subtotalArs + (order.shippingCostArs ?? 0), 0)
  const partialRefundOrders = active.filter((order) => order.partiallyRefunded).length
  const completeOrders = active.filter((order) =>
    !order.partiallyRefunded
    && order.items.every((item) => item.unitCostArs !== null)
    && (order.deliveryMethod === 'PICKUP' || (order.shippingCostArs !== null && order.shippingInternalCostArs !== null)),
  )
  const completeIds = new Set(completeOrders.map((order) => order.orderId))
  const knownProductCostArs = active.reduce((sum, order) => sum + order.items.reduce((lineSum, item) =>
    lineSum + (item.unitCostArs === null ? 0 : item.unitCostArs * item.quantity), 0), 0)
  const productCostArs = completeOrders.reduce((sum, order) => sum + order.items.reduce((lineSum, item) =>
    lineSum + (item.unitCostArs ?? 0) * item.quantity, 0), 0)
  const logisticsCostArs = completeOrders.reduce((sum, order) =>
    sum + (order.deliveryMethod === 'PICKUP' ? 0 : order.shippingInternalCostArs ?? 0), 0)
  const completeRevenueArs = completeOrders.reduce((sum, order) => sum + order.subtotalArs + (order.shippingCostArs ?? 0), 0)
  const products = new Map<string, { productName: string; productSku: string; quantity: number; revenueArs: number; costArs: number | null }>()
  for (const order of active.filter((item) => !item.partiallyRefunded)) {
    for (const item of order.items) {
      const key = item.productSku
      const current = products.get(key) || { productName: item.productName, productSku: item.productSku, quantity: 0, revenueArs: 0, costArs: 0 }
      current.quantity += item.quantity
      current.revenueArs += item.lineTotalArs
      if (item.unitCostArs === null) current.costArs = null
      else if (current.costArs !== null) current.costArs += item.unitCostArs * item.quantity
      products.set(key, current)
    }
  }
  return {
    summary: {
      paidOrders: orders.length,
      activePaidOrders: active.length,
      fullyRefundedOrders: refundedOrders.length,
      fullyRefundedArs,
      productRevenueArs,
      shippingChargedArs,
      netRevenueArs: productRevenueArs + shippingChargedArs,
      knownProductCostArs,
      completeOrders: completeOrders.length,
      incompleteOrders: active.length - completeOrders.length,
      partialRefundOrders,
      productCostArs,
      logisticsCostArs,
      estimatedGrossMarginArs: completeRevenueArs - productCostArs - logisticsCostArs,
      marginCoveragePercent: active.length ? Math.round(completeOrders.length / active.length * 100) : 0,
    },
    products: [...products.values()].sort((a, b) => b.revenueArs - a.revenueArs),
    orders: active.map((order) => ({
      orderId: order.orderId,
      orderCode: order.orderCode,
      paidAt: order.paidAt,
      productRevenueArs: order.subtotalArs,
      shippingChargedArs: order.shippingCostArs ?? 0,
      productCostArs: order.items.reduce((sum, item) => sum + (item.unitCostArs ?? 0) * item.quantity, 0),
      logisticsCostArs: order.deliveryMethod === 'PICKUP' ? 0 : order.shippingInternalCostArs,
      estimatedMarginArs: completeIds.has(order.orderId)
        ? order.subtotalArs + (order.shippingCostArs ?? 0) - order.items.reduce((sum, item) => sum + (item.unitCostArs ?? 0) * item.quantity, 0) - (order.deliveryMethod === 'PICKUP' ? 0 : order.shippingInternalCostArs ?? 0)
        : null,
      hasPartialRefund: order.partiallyRefunded,
    })).sort((a, b) => b.paidAt.getTime() - a.paidAt.getTime()),
  }
}
