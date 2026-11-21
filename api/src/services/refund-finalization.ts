import { prisma } from '../lib/prisma'

/**
 * Finalizes a fully confirmed refund only while the parcel is still under the
 * store's control. The order lock makes the stock restoration exactly-once.
 * Dispatched/delivered returns use the separate physical-return workflow.
 */
export async function finalizePreDispatchRefund(orderId: string, changedByAdminId: string | null, note: string) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRawUnsafe('SELECT pg_advisory_xact_lock(hashtextextended($1, 1))::text AS locked', orderId)
    const order = await tx.order.findUnique({
      where: { id: orderId },
      include: { items: true, paymentAttempts: { select: { status: true } }, cancellationRequest: { select: { status: true } } },
    })
    if (!order) return 'ORDER_NOT_FOUND' as const
    if (order.status === 'CANCELLED') return 'ALREADY_CANCELLED' as const
    if (['SHIPPED', 'DELIVERED'].includes(order.status)) return 'RETURN_WORKFLOW_REQUIRED' as const
    if (order.cancellationRequest?.status !== 'REFUNDED') return 'REFUND_NOT_CONFIRMED' as const
    if (order.paymentAttempts.some((attempt) => ['CREATING', 'PENDING', 'UNKNOWN', 'APPROVED', 'PARTIALLY_REFUNDED'].includes(attempt.status))) {
      return 'OTHER_PAYMENT_ATTEMPT_UNRESOLVED' as const
    }
    const changed = await tx.order.updateMany({
      where: { id: order.id, status: { in: ['PENDING', 'CONFIRMED', 'PREPARING'] } },
      data: { status: 'CANCELLED' },
    })
    if (changed.count !== 1) return 'ORDER_STATE_CHANGED' as const
    for (const item of order.items) {
      if (item.productId) {
        await tx.product.update({ where: { id: item.productId }, data: { stock: { increment: item.quantity } } })
      }
    }
    await tx.orderStatusHistory.create({
      data: {
        orderId: order.id,
        fromStatus: order.status,
        toStatus: 'CANCELLED',
        note,
        changedByAdminId,
      },
    })
    return 'CANCELLED' as const
  })
}
