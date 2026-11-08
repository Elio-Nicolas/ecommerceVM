import { randomBytes } from 'node:crypto'
import { Router } from 'express'
import { rateLimit } from 'express-rate-limit'
import { Prisma } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '../lib/prisma'

export const ordersRouter = Router()

const createOrderLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: { code: 'ORDER_RATE_LIMIT', message: 'Se alcanzó el límite de pedidos. Intentá nuevamente más tarde.' } },
})

const createOrderSchema = z.object({
  customerName: z.string().trim().min(2).max(120),
  customerEmail: z.union([z.string().trim().email().max(160), z.literal('')]).optional().transform((value) => value || null),
  customerPhone: z.string().trim().min(8).max(30).regex(/^[+0-9\s().-]+$/, 'Ingresá un teléfono válido.'),
  addressLine: z.string().trim().min(4).max(180),
  city: z.string().trim().min(2).max(100),
  province: z.string().trim().min(2).max(100),
  postalCode: z.string().trim().max(20).optional().transform((value) => value || null),
  customerNotes: z.string().trim().max(1000).optional().transform((value) => value || null),
  items: z.array(z.object({
    productId: z.string().uuid(),
    quantity: z.number().int().min(1).max(99),
  })).min(1).max(30).superRefine((items, ctx) => {
    const ids = items.map((item) => item.productId)
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'No repitas productos en el pedido.' })
    }
  }),
})

class OrderConflictError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'OrderConflictError'
  }
}

ordersRouter.post('/', createOrderLimiter, async (req, res) => {
  const input = createOrderSchema.parse(req.body)
  try {
    const order = await prisma.$transaction(async (tx) => {
      const products = await tx.product.findMany({
        where: { id: { in: input.items.map((item) => item.productId) }, status: 'ACTIVE' },
        select: { id: true, sku: true, name: true, priceArs: true, stock: true },
      })
      if (products.length !== input.items.length) {
        throw new OrderConflictError('Uno o más productos ya no están disponibles. Actualizá el carrito.')
      }
      const byId = new Map(products.map((product) => [product.id, product]))
      let subtotalArs = 0
      const snapshots = input.items.map((item) => {
        const product = byId.get(item.productId)!
        subtotalArs += product.priceArs * item.quantity
        return {
          productId: product.id,
          productName: product.name,
          productSku: product.sku,
          unitPriceArs: product.priceArs,
          quantity: item.quantity,
          lineTotalArs: product.priceArs * item.quantity,
        }
      })
      if (!Number.isSafeInteger(subtotalArs) || subtotalArs < 1 || subtotalArs > 2_000_000_000) {
        throw new OrderConflictError('El importe del pedido no es válido.')
      }
      for (const item of input.items) {
        const reserved = await tx.product.updateMany({
          where: { id: item.productId, status: 'ACTIVE', stock: { gte: item.quantity } },
          data: { stock: { decrement: item.quantity } },
        })
        if (reserved.count !== 1) {
          throw new OrderConflictError('No hay stock suficiente para uno o más productos. Actualizá el carrito.')
        }
      }
      const code = `EV-${Date.now().toString(36).toUpperCase()}-${randomBytes(3).toString('hex').toUpperCase()}`
      return tx.order.create({
        data: {
          code,
          customerName: input.customerName,
          customerEmail: input.customerEmail,
          customerPhone: input.customerPhone,
          addressLine: input.addressLine,
          city: input.city,
          province: input.province,
          postalCode: input.postalCode,
          customerNotes: input.customerNotes,
          subtotalArs,
          items: { create: snapshots },
          history: { create: { toStatus: 'PENDING', note: 'Pedido recibido; pendiente de confirmación.' } },
        },
        include: { items: true },
      })
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
    res.status(201).json({
      data: {
        id: order.id,
        code: order.code,
        status: order.status,
        subtotalArs: order.subtotalArs,
        shippingCostArs: order.shippingCostArs,
        totalArs: order.totalArs,
        createdAt: order.createdAt,
        items: order.items,
      },
      message: 'Pedido recibido. El envío y el importe final quedan sujetos a confirmación.',
    })
  } catch (error) {
    if (error instanceof OrderConflictError) {
      res.status(409).json({ error: { code: 'ORDER_CONFLICT', message: error.message } })
      return
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') {
      res.status(409).json({ error: { code: 'ORDER_CONFLICT', message: 'El stock cambió mientras procesábamos el pedido. Intentá nuevamente.' } })
      return
    }
    throw error
  }
})
