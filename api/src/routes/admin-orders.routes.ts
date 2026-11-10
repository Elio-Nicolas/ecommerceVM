import { Router } from 'express'
import { OrderStatus, Prisma } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import { requireAdmin } from '../middleware/require-admin'

export const adminOrdersRouter = Router()
adminOrdersRouter.use(requireAdmin)

const listSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(30),
  status: z.nativeEnum(OrderStatus).optional(),
  q: z.string().trim().max(120).optional(),
})

const transitions: Record<OrderStatus, OrderStatus[]> = {
  PENDING: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['PREPARING', 'CANCELLED'],
  PREPARING: ['SHIPPED', 'CANCELLED'],
  SHIPPED: ['DELIVERED'],
  DELIVERED: [],
  CANCELLED: [],
}

const orderInclude = {
  items: true,
  history: { orderBy: { createdAt: 'desc' as const }, include: { changedByAdmin: { select: { email: true } } } },
}

adminOrdersRouter.get('/', async (req, res) => {
  const query = listSchema.parse(req.query)
  const where: Prisma.OrderWhereInput = {
    ...(query.status ? { status: query.status } : {}),
    ...(query.q ? {
      OR: [
        { code: { contains: query.q, mode: 'insensitive' } },
        { customerName: { contains: query.q, mode: 'insensitive' } },
        { customerPhone: { contains: query.q } },
      ],
    } : {}),
  }
  const [data, total] = await prisma.$transaction([
    prisma.order.findMany({
      where,
      include: orderInclude,
      orderBy: { createdAt: 'desc' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    }),
    prisma.order.count({ where }),
  ])
  res.json({ data, pagination: { page: query.page, limit: query.limit, total, totalPages: Math.ceil(total / query.limit) } })
})

adminOrdersRouter.get('/:id', async (req, res) => {
  const order = await prisma.order.findUnique({ where: { id: req.params.id }, include: orderInclude })
  if (!order) {
    res.status(404).json({ error: { code: 'ORDER_NOT_FOUND', message: 'Pedido no encontrado.' } })
    return
  }
  res.json({ data: order })
})

adminOrdersRouter.patch('/:id/shipping', async (req, res) => {
  const input = z.object({
    shippingCostArs: z.number().int().min(0).max(2_000_000_000),
    shippingCarrier: z.string().trim().max(100).nullable().optional().transform((value) => value || null),
    trackingCode: z.string().trim().max(120).nullable().optional().transform((value) => value || null),
  }).parse(req.body)

  const existing = await prisma.order.findUnique({ where: { id: req.params.id } })
  if (!existing) {
    res.status(404).json({ error: { code: 'ORDER_NOT_FOUND', message: 'Pedido no encontrado.' } })
    return
  }
  if (existing.deliveryMethod === 'LOCAL_DELIVERY') {
    if (existing.shippingService !== 'A coordinar') {
      res.status(409).json({ error: { code: 'SHIPPING_METHOD_NOT_SUPPORTED', message: 'El costo manual solo se puede registrar para entregas locales configuradas como A coordinar.' } })
      return
    }
    if (['SHIPPED', 'DELIVERED', 'CANCELLED'].includes(existing.status)) {
      res.status(409).json({ error: { code: 'ORDER_ALREADY_DISPATCHED', message: 'El costo de entrega local debe registrarse antes de despachar el pedido.' } })
      return
    }
    const totalArs = existing.subtotalArs + input.shippingCostArs
    if (!Number.isSafeInteger(totalArs) || totalArs > 2_000_000_000) {
      res.status(400).json({ error: { code: 'INVALID_ORDER_TOTAL', message: 'El total del pedido supera el importe permitido.' } })
      return
    }
    const updated = await prisma.$transaction(async (tx) => {
      await tx.order.update({
        where: { id: existing.id },
        data: { shippingCostArs: input.shippingCostArs, totalArs },
      })
      await tx.orderStatusHistory.create({
        data: {
          orderId: existing.id,
          fromStatus: existing.status,
          toStatus: existing.status,
          note: `Costo de entrega local coordinado: ${input.shippingCostArs.toLocaleString('es-AR')}.`,
          changedByAdminId: req.admin?.id || null,
        },
      })
      return tx.order.findUnique({ where: { id: existing.id }, include: orderInclude })
    })
    res.json({ data: updated, message: 'Costo de entrega local registrado.' })
    return
  }
  if (existing.status === 'CANCELLED') {
    res.status(409).json({ error: { code: 'ORDER_CANCELLED', message: 'No se puede cotizar el envío de un pedido cancelado.' } })
    return
  }
  if (existing.deliveryMethod !== 'ENVIOPACK') {
    res.status(409).json({ error: { code: 'SHIPPING_METHOD_NOT_SUPPORTED', message: 'La edición manual del costo y seguimiento está disponible únicamente para pedidos Envíopack.' } })
    return
  }

  const totalArs = existing.subtotalArs + input.shippingCostArs
  if (!Number.isSafeInteger(totalArs) || totalArs > 2_000_000_000) {
    res.status(400).json({ error: { code: 'INVALID_ORDER_TOTAL', message: 'El total del pedido supera el importe permitido.' } })
    return
  }

  const updated = await prisma.$transaction(async (tx) => {
    await tx.order.update({
      where: { id: existing.id },
      data: {
        shippingCostArs: input.shippingCostArs,
        totalArs,
        shippingCarrier: input.shippingCarrier,
        trackingCode: input.trackingCode,
      },
    })
    const trackingDetails = [
      input.shippingCarrier ? `Transporte: ${input.shippingCarrier}` : null,
      input.trackingCode ? `Seguimiento: ${input.trackingCode}` : null,
    ].filter(Boolean).join(' · ')
    await tx.orderStatusHistory.create({
      data: {
        orderId: existing.id,
        fromStatus: existing.status,
        toStatus: existing.status,
        note: `Envío actualizado. Costo: ${input.shippingCostArs.toLocaleString('es-AR')}.${trackingDetails ? ` ${trackingDetails}.` : ''}`,
        changedByAdminId: req.admin?.id || null,
      },
    })
    return tx.order.findUnique({ where: { id: existing.id }, include: orderInclude })
  })

  res.json({ data: updated, message: 'Datos de envío actualizados.' })
})

adminOrdersRouter.patch('/:id/status', async (req, res) => {
  const input = z.object({
    status: z.nativeEnum(OrderStatus),
    note: z.string().trim().max(500).optional(),
  }).parse(req.body)
  const existing = await prisma.order.findUnique({
    where: { id: req.params.id },
    include: { items: true },
  })
  if (!existing) {
    res.status(404).json({ error: { code: 'ORDER_NOT_FOUND', message: 'Pedido no encontrado.' } })
    return
  }
  if (input.status === 'SHIPPED' && existing.deliveryMethod === 'ENVIOPACK' && (existing.shippingCostArs === null || !existing.shippingCarrier)) {
    res.status(409).json({ error: { code: 'SHIPPING_NOT_CONFIGURED', message: 'Antes de marcar el pedido como enviado, registrá el costo y el transporte.' } })
    return
  }
  if (input.status === 'SHIPPED' && existing.deliveryMethod === 'LOCAL_DELIVERY' && existing.shippingService === 'A coordinar' && existing.shippingCostArs === null) {
    res.status(409).json({ error: { code: 'LOCAL_DELIVERY_COST_REQUIRED', message: 'Antes de despachar el pedido, registrá el costo de entrega local acordado con el comprador.' } })
    return
  }
  const allowedTransitions = existing.status === 'PREPARING' && existing.deliveryMethod === 'PICKUP'
    ? ['DELIVERED', 'CANCELLED']
    : transitions[existing.status]
  if (input.status === existing.status || !allowedTransitions.includes(input.status)) {
    res.status(409).json({ error: { code: 'INVALID_ORDER_TRANSITION', message: 'Ese cambio de estado no está permitido.' } })
    return
  }

  try {
    const updated = await prisma.$transaction(async (tx) => {
      const changed = await tx.order.updateMany({
        where: { id: existing.id, status: existing.status },
        data: { status: input.status },
      })
      if (changed.count !== 1) throw new Error('ORDER_STATUS_CONFLICT')
      if (input.status === 'CANCELLED') {
        for (const item of existing.items) {
          if (item.productId) {
            await tx.product.update({
              where: { id: item.productId },
              data: { stock: { increment: item.quantity } },
            })
          }
        }
      }
      await tx.orderStatusHistory.create({
        data: {
          orderId: existing.id,
          fromStatus: existing.status,
          toStatus: input.status,
          note: input.note || null,
          changedByAdminId: req.admin?.id || null,
        },
      })
      return tx.order.findUnique({ where: { id: existing.id }, include: orderInclude })
    })
    res.json({ data: updated })
  } catch (error) {
    if (error instanceof Error && error.message === 'ORDER_STATUS_CONFLICT') {
      res.status(409).json({ error: { code: 'ORDER_STATUS_CONFLICT', message: 'El pedido fue actualizado por otra sesión. Recargá e intentá nuevamente.' } })
      return
    }
    throw error
  }
})
