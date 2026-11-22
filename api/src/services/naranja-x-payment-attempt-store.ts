import type { PrismaClient } from '@prisma/client'
import type { NaranjaXAttemptRecord, NaranjaXAttemptStatus, NaranjaXAttemptStore, NaranjaXOrderForPayment } from './naranja-x-payment-attempt'

/** Prisma-backed durable store. PaymentAttempt.provider is a string, so no enum migration is needed. */
export function createPrismaNaranjaXAttemptStore(prisma: PrismaClient): NaranjaXAttemptStore {
  return {
    async findOrder(orderId): Promise<NaranjaXOrderForPayment | null> {
      return prisma.order.findUnique({
        where: { id: orderId },
        select: { id: true, code: true, totalArs: true, status: true },
      })
    },
    async findByRequestKey(requestKey): Promise<NaranjaXAttemptRecord | null> {
      return prisma.paymentAttempt.findUnique({ where: { requestKey } }) as Promise<NaranjaXAttemptRecord | null>
    },
    async findActiveForOrder(orderId): Promise<NaranjaXAttemptRecord | null> {
      return prisma.paymentAttempt.findFirst({
        where: { orderId, provider: 'NARANJA_X', status: { in: ['CREATING', 'PENDING', 'UNKNOWN'] } },
        orderBy: { createdAt: 'desc' },
      }) as Promise<NaranjaXAttemptRecord | null>
    },
    async create(input): Promise<NaranjaXAttemptRecord> {
      return prisma.paymentAttempt.create({
        data: { ...input, provider: 'NARANJA_X', currencyCode: 'ARS', status: 'CREATING' },
      }) as Promise<NaranjaXAttemptRecord>
    },
    async update(id, input): Promise<NaranjaXAttemptRecord> {
      return prisma.paymentAttempt.update({
        where: { id },
        data: {
          status: input.status,
          ...(input.providerOrderId ? { providerOrderId: input.providerOrderId } : {}),
          ...(input.checkoutUrl ? { checkoutUrl: input.checkoutUrl } : {}),
          ...(input.responsePayload ? { responsePayload: input.responsePayload } : {}),
          ...(input.lastError !== undefined ? { lastError: input.lastError } : {}),
        },
      }) as Promise<NaranjaXAttemptRecord>
    },
  }
}
