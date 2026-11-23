import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import { requireAdmin } from '../middleware/require-admin'
import { buildSalesReport, getSalesDateRange, type SalesPaymentMethod, type SalesTransaction } from '../services/sales-report'

export const adminSalesRouter = Router()
adminSalesRouter.use(requireAdmin)

const querySchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
})

adminSalesRouter.get('/', async (req, res) => {
  const query = querySchema.safeParse(req.query)
  if (!query.success) {
    res.status(400).json({ error: { code: 'SALES_REPORT_QUERY_INVALID', message: 'Revisá las fechas seleccionadas.' } })
    return
  }

  let range: ReturnType<typeof getSalesDateRange>
  try {
    range = getSalesDateRange(query.data.from, query.data.to)
  } catch (error) {
    res.status(400).json({ error: { code: 'SALES_REPORT_RANGE_INVALID', message: error instanceof Error ? error.message : 'El período seleccionado no es válido.' } })
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
      id: true,
      code: true,
      status: true,
      customerName: true,
      customerPhone: true,
      paymentMethod: true,
      totalArs: true,
      deliveryMethod: true,
      paymentReceivedAt: true,
      cancellationRequest: { select: { status: true, providerStatus: true } },
      items: { select: { productName: true, quantity: true, lineTotalArs: true } },
      paymentAttempts: {
        where: { status: { in: [...paidStatuses] }, approvedAt: { gte: range.start, lt: range.endExclusive } },
        select: { id: true, provider: true, providerOrderId: true, status: true, amountArs: true, approvedAt: true },
        orderBy: { approvedAt: 'desc' },
      },
    },
    orderBy: { createdAt: 'desc' },
  })

  const transactions: SalesTransaction[] = []
  for (const order of orders) {
    if (order.paymentMethod === 'CASH' && order.paymentReceivedAt) {
      const fullyRefunded = order.cancellationRequest?.status === 'REFUNDED'
        && order.cancellationRequest.providerStatus === 'MANUAL_CONFIRMED_CASH'
      const noPaymentCollected = order.cancellationRequest?.providerStatus === 'NO_PAYMENT_COLLECTED'
      if (!noPaymentCollected && order.totalArs !== null && order.totalArs > 0) {
        transactions.push({
          id: `cash:${order.id}`,
          orderId: order.id,
          orderCode: order.code,
          customerName: order.customerName,
          customerPhone: order.customerPhone,
          paymentMethod: 'CASH',
          amountArs: order.totalArs,
          paidAt: order.paymentReceivedAt,
          orderStatus: order.status,
          deliveryMethod: order.deliveryMethod,
          refundStatus: fullyRefunded ? 'FULL' : 'NONE',
          refundAmountArs: fullyRefunded ? order.totalArs : 0,
          providerReference: null,
          paymentStatus: fullyRefunded ? 'REFUNDED' : 'RECEIVED',
          items: order.items,
        })
      }
    }
    for (const attempt of order.paymentAttempts) {
      if (!attempt.approvedAt) continue
      const method: SalesPaymentMethod = attempt.provider === 'GOCUOTAS' ? 'GOCUOTAS' : 'MERCADO_PAGO'
      transactions.push({
        id: attempt.id,
        orderId: order.id,
        orderCode: order.code,
        customerName: order.customerName,
        customerPhone: order.customerPhone,
        paymentMethod: method,
        amountArs: attempt.amountArs,
        paidAt: attempt.approvedAt,
        orderStatus: order.status,
        deliveryMethod: order.deliveryMethod,
        refundStatus: attempt.status === 'REFUNDED' ? 'FULL' : attempt.status === 'PARTIALLY_REFUNDED' ? 'PARTIAL' : 'NONE',
        refundAmountArs: attempt.status === 'REFUNDED' ? attempt.amountArs : 0,
        providerReference: attempt.providerOrderId,
        paymentStatus: attempt.status,
        items: order.items,
      })
    }
  }

  const report = buildSalesReport(transactions)
  res.json({ data: { period: { from: range.from, to: range.to, days: range.days }, ...report } })
})
