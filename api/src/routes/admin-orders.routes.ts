import { Router } from 'express'
import { OrderStatus, Prisma } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import { requireAdmin } from '../middleware/require-admin'
import { wouldChangeOrderTotal } from '../services/shipping-total-consistency'

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
  paymentAttempts: { orderBy: { createdAt: 'desc' as const }, select: { id: true, provider: true, providerOrderId: true, status: true, statusDetail: true, amountArs: true, approvedAt: true, createdAt: true } },
  fiscalDocuments: { orderBy: { createdAt: 'desc' as const }, select: { id: true, type: true, status: true, pointOfSale: true, voucherType: true, voucherNumber: true, cae: true, caeExpiresAt: true, lastErrorMessage: true, createdAt: true } },
  history: { orderBy: { createdAt: 'desc' as const }, include: { changedByAdmin: { select: { email: true } } } },
  shipments: { where: { provider: 'OCA' }, select: { provider: true, status: true, trackingNumber: true } },
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
      await tx.$queryRawUnsafe('SELECT pg_advisory_xact_lock(hashtextextended($1, 1))', existing.id)
      const currentOrder = await tx.order.findUnique({
        where: { id: existing.id },
        select: { subtotalArs: true, shippingCostArs: true, totalArs: true },
      })
      if (!currentOrder) return null
      const nextTotalArs = currentOrder.subtotalArs + input.shippingCostArs
      if (wouldChangeOrderTotal(currentOrder.subtotalArs, input.shippingCostArs, currentOrder.totalArs)) {
        const blockingPayment = await tx.paymentAttempt.findFirst({
          where: { orderId: existing.id, provider: 'MERCADO_PAGO', status: { in: ['CREATING', 'PENDING', 'UNKNOWN', 'APPROVED', 'PARTIALLY_REFUNDED', 'REFUNDED'] } },
          select: { id: true },
        })
        if (blockingPayment) return null
      }
      await tx.order.update({
        where: { id: existing.id },
        data: { shippingCostArs: input.shippingCostArs, totalArs: nextTotalArs },
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
    if (!updated) {
      res.status(409).json({ error: { code: 'PAYMENT_ALREADY_STARTED', message: 'No se puede modificar el costo de entrega porque el pedido tiene un pago iniciado o registrado. Primero resolvé el pago en Mercado Pago.' } })
      return
    }
    res.json({ data: updated, message: 'Costo de entrega local registrado.' })
    return
  }
  if (existing.status === 'CANCELLED') {
    res.status(409).json({ error: { code: 'ORDER_CANCELLED', message: 'No se puede cotizar el envío de un pedido cancelado.' } })
    return
  }
  if (existing.deliveryMethod !== 'OCA') {
    res.status(409).json({ error: { code: 'SHIPPING_METHOD_NOT_SUPPORTED', message: 'La edición manual del costo y seguimiento está disponible únicamente para envíos OCA.' } })
    return
  }

  const totalArs = existing.subtotalArs + input.shippingCostArs
  if (!Number.isSafeInteger(totalArs) || totalArs > 2_000_000_000) {
    res.status(400).json({ error: { code: 'INVALID_ORDER_TOTAL', message: 'El total del pedido supera el importe permitido.' } })
    return
  }

  const updated = await prisma.$transaction(async (tx) => {
    await tx.$queryRawUnsafe('SELECT pg_advisory_xact_lock(hashtextextended($1, 1))', existing.id)
    const currentOrder = await tx.order.findUnique({
      where: { id: existing.id },
      select: { subtotalArs: true, shippingCostArs: true, totalArs: true },
    })
    if (!currentOrder) return null
    const nextTotalArs = currentOrder.subtotalArs + input.shippingCostArs
    if (wouldChangeOrderTotal(currentOrder.subtotalArs, input.shippingCostArs, currentOrder.totalArs)) {
      const blockingPayment = await tx.paymentAttempt.findFirst({
        where: { orderId: existing.id, provider: 'MERCADO_PAGO', status: { in: ['CREATING', 'PENDING', 'UNKNOWN', 'APPROVED', 'PARTIALLY_REFUNDED', 'REFUNDED'] } },
        select: { id: true },
      })
      if (blockingPayment) return null
    }
    await tx.order.update({
      where: { id: existing.id },
      data: {
        shippingCostArs: input.shippingCostArs,
        totalArs: nextTotalArs,
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

  if (!updated) {
    res.status(409).json({ error: { code: 'PAYMENT_ALREADY_STARTED', message: 'No se puede modificar el costo de envío porque el pedido tiene un pago iniciado o registrado. Primero resolvé el pago en Mercado Pago.' } })
    return
  }
  res.json({ data: updated, message: 'Datos de envío actualizados.' })
})

adminOrdersRouter.patch('/:id/status', async (req, res) => {
  const input = z.object({
    status: z.nativeEnum(OrderStatus),
    note: z.string().trim().max(500).optional(),
  }).parse(req.body)
  const existing = await prisma.order.findUnique({
    where: { id: req.params.id },
    include: { items: true, paymentAttempts: { select: { status: true, provider: true } }, shipments: { where: { provider: 'OCA' }, select: { provider: true, status: true, trackingNumber: true } } },
  })
  if (!existing) {
    res.status(404).json({ error: { code: 'ORDER_NOT_FOUND', message: 'Pedido no encontrado.' } })
    return
  }
  if (input.status !== existing.status && existing.paymentAttempts.some((payment) => payment.provider === 'MERCADO_PAGO' && payment.status === 'REFUNDED') && input.status !== 'CANCELLED') {
    res.status(409).json({ error: { code: 'PAYMENT_REFUNDED', message: 'El pago fue reembolsado por completo. Cancelá el pedido antes de continuar con la preparación o el despacho.' } })
    return
  }
  if (input.status !== existing.status && existing.paymentAttempts.some((payment) => payment.provider === 'MERCADO_PAGO' && payment.status === 'PARTIALLY_REFUNDED')) {
    res.status(409).json({ error: { code: 'PAYMENT_PARTIALLY_REFUNDED', message: 'El pago tuvo un reembolso parcial. Revisá la operación en Mercado Pago antes de cambiar el estado del pedido.' } })
    return
  }
  if (input.status === 'CANCELLED' && existing.paymentAttempts.some((payment) => payment.provider === 'MERCADO_PAGO' && ['CREATING', 'PENDING', 'UNKNOWN', 'APPROVED', 'PARTIALLY_REFUNDED'].includes(payment.status))) {
    res.status(409).json({ error: { code: 'PAYMENT_NOT_RESOLVED', message: 'No se puede cancelar el pedido mientras exista un pago de Mercado Pago pendiente, incierto o aprobado. Primero resolvé el cobro o gestioná la devolución correspondiente.' } })
    return
  }
  if (input.status === 'CONFIRMED' && existing.paymentAttempts.some((payment) => payment.provider === 'MERCADO_PAGO' && ['CREATING', 'PENDING', 'UNKNOWN'].includes(payment.status))) {
    res.status(409).json({ error: { code: 'PAYMENT_NOT_RESOLVED', message: 'Este pedido tiene un pago de Mercado Pago pendiente o sin resultado concluyente. Verificá el estado del pago antes de confirmarlo manualmente.' } })
    return
  }
  if (input.status === 'CONFIRMED' && existing.deliveryMethod === 'LOCAL_DELIVERY' && existing.shippingService === 'A coordinar' && existing.shippingCostArs === null) {
    res.status(409).json({ error: { code: 'LOCAL_DELIVERY_COST_REQUIRED', message: 'Primero registrá el costo acordado de entrega local. Después podrás confirmar el costo y continuar con el pedido.' } })
    return
  }
  if (input.status === 'SHIPPED' && existing.deliveryMethod === 'OCA') {
    const admittedShipment = existing.shipments.some((shipment) => shipment.status === 'PROCESSED' && Boolean(shipment.trackingNumber))
    if (!admittedShipment) {
      res.status(409).json({ error: { code: 'OCA_SHIPMENT_NOT_PROCESSED', message: 'El pedido solo puede marcarse como enviado cuando OCA confirme la admisión y exista un número de seguimiento.' } })
      return
    }
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
