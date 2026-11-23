import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import { requireAdmin } from '../middleware/require-admin'
import { getSalesDateRange } from '../services/sales-report'
import { buildProfitabilityReport, type ProfitabilityOrder } from '../services/profitability-report'

export const adminProfitabilityRouter = Router()
adminProfitabilityRouter.use(requireAdmin)

adminProfitabilityRouter.get('/', async (req, res) => {
  const query = z.object({ from: z.string().optional(), to: z.string().optional() }).safeParse(req.query)
  if (!query.success) {
    res.status(400).json({ error: { code: 'PROFITABILITY_QUERY_INVALID', message: 'Revisá las fechas seleccionadas.' } })
    return
  }
  let range: ReturnType<typeof getSalesDateRange>
  try {
    range = getSalesDateRange(query.data.from, query.data.to)
  } catch (error) {
    res.status(400).json({ error: { code: 'PROFITABILITY_RANGE_INVALID', message: error instanceof Error ? error.message : 'El período no es válido.' } })
    return
  }
  const paidStatuses = ['APPROVED', 'PARTIALLY_REFUNDED', 'REFUNDED'] as const
  const orders = await prisma.order.findMany({
    where: {
      OR: [
        { paymentMethod: 'CASH', paymentReceivedAt: { gte: range.start, lt: range.endExclusive } },
        { paymentAttempts: { some: { status: { in: [...paidStatuses] }, approvedAt: { gte: range.start, lt: range.endExclusive } } } },
      ],
    },
    select: {
      id: true, code: true, paymentMethod: true, subtotalArs: true, shippingCostArs: true, shippingInternalCostArs: true,
      deliveryMethod: true, paymentReceivedAt: true,
      items: { select: { productName: true, productSku: true, quantity: true, lineTotalArs: true, unitCostArs: true } },
      cancellationRequest: { select: { status: true, providerStatus: true } },
      paymentAttempts: {
        where: { status: { in: [...paidStatuses] }, approvedAt: { gte: range.start, lt: range.endExclusive } },
        select: { status: true, approvedAt: true },
        orderBy: { approvedAt: 'desc' },
      },
    },
    orderBy: { createdAt: 'desc' },
  })
  const rows: ProfitabilityOrder[] = []
  for (const order of orders) {
    const attempt = order.paymentAttempts[0] || null
    const paidAt = order.paymentMethod === 'CASH' ? order.paymentReceivedAt : attempt?.approvedAt
    if (!paidAt) continue
    const fullyRefunded = order.paymentMethod === 'CASH'
      ? order.cancellationRequest?.status === 'REFUNDED' && order.cancellationRequest.providerStatus === 'MANUAL_CONFIRMED_CASH'
      : attempt?.status === 'REFUNDED'
    const partiallyRefunded = attempt?.status === 'PARTIALLY_REFUNDED'
    rows.push({
      orderId: order.id,
      orderCode: order.code,
      paidAt,
      subtotalArs: order.subtotalArs,
      shippingCostArs: order.shippingCostArs,
      shippingInternalCostArs: order.shippingInternalCostArs,
      deliveryMethod: order.deliveryMethod,
      fullyRefunded,
      partiallyRefunded,
      items: order.items,
    })
  }
  res.json({ data: { period: { from: range.from, to: range.to, days: range.days }, ...buildProfitabilityReport(rows) } })
})
