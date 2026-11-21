import { prisma } from '../lib/prisma'

export async function acceptReturnedOrderStock(orderId: string, changedByAdminId: string | null) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRawUnsafe('SELECT pg_advisory_xact_lock(hashtextextended($1, 1))::text AS locked', orderId)
    const request = await tx.cancellationRequest.findUnique({
      where: { orderId },
      include: { order: { include: { items: true } } },
    })
    if (!request) return 'REQUEST_NOT_FOUND' as const
    if (request.returnStatus === 'RETURN_ACCEPTED') return 'ALREADY_ACCEPTED' as const
    if (request.returnStatus !== 'RETURN_RECEIVED') return 'RETURN_NOT_RECEIVED' as const
    for (const item of request.order.items) {
      if (item.productId) {
        await tx.product.update({ where: { id: item.productId }, data: { stock: { increment: item.quantity } } })
      }
    }
    await tx.cancellationRequest.update({ where: { id: request.id }, data: { returnStatus: 'RETURN_ACCEPTED' } })
    await tx.orderStatusHistory.create({
      data: { orderId, fromStatus: request.order.status, toStatus: request.order.status, note: 'La tienda inspeccionó y aceptó la devolución. El producto fue reingresado al stock.', changedByAdminId },
    })
    return 'RETURN_ACCEPTED' as const
  })
}
