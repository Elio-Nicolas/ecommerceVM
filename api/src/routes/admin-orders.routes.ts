import { Router } from 'express'
import { OrderStatus, Prisma } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import { env } from '../config/env'
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
  cancellationRequest: true,
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
    forceCancelUnpaidTest: z.boolean().optional(),
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
  if (input.status === 'CANCELLED') {
    const blockingPayments = existing.paymentAttempts.filter((payment) =>
      payment.provider === 'MERCADO_PAGO'
      && ['CREATING', 'PENDING', 'UNKNOWN', 'APPROVED', 'PARTIALLY_REFUNDED'].includes(payment.status),
    )
    const unsafePayments = blockingPayments.some((payment) => ['APPROVED', 'PARTIALLY_REFUNDED'].includes(payment.status))
    const hasUnresolvedPayments = blockingPayments.length > 0
    if (unsafePayments || (hasUnresolvedPayments && !input.forceCancelUnpaidTest)) {
      res.status(409).json({ error: { code: 'PAYMENT_NOT_RESOLVED', message: 'No se puede cancelar: hay un pago aprobado, parcialmente reembolsado o pendiente de resolución. Para pedidos de prueba no pagados, usá la acción administrativa específica.' } })
      return
    }
    if (input.forceCancelUnpaidTest && existing.status !== 'PENDING') {
      res.status(409).json({ error: { code: 'TEST_CANCELLATION_NOT_ALLOWED', message: 'La cancelación excepcional solo está disponible para pedidos pendientes.' } })
      return
    }
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
      // Serialize cancellation with payment reconciliation/webhooks so stock is restored once
      // and a concurrently approved payment cannot be silently cancelled.
      await tx.$queryRawUnsafe('SELECT pg_advisory_xact_lock(hashtextextended($1, 1))', existing.id)
      const currentOrder = await tx.order.findUnique({
        where: { id: existing.id },
        include: { items: true, paymentAttempts: { select: { provider: true, status: true } } },
      })
      if (!currentOrder || currentOrder.status !== existing.status) throw new Error('ORDER_STATUS_CONFLICT')
      if (input.status === 'CANCELLED') {
        const currentBlockingPayments = currentOrder.paymentAttempts.filter((payment) =>
          payment.provider === 'MERCADO_PAGO'
          && ['CREATING', 'PENDING', 'UNKNOWN', 'APPROVED', 'PARTIALLY_REFUNDED'].includes(payment.status),
        )
        const currentUnsafePayment = currentBlockingPayments.some((payment) => ['APPROVED', 'PARTIALLY_REFUNDED'].includes(payment.status))
        if (currentUnsafePayment || (currentBlockingPayments.length > 0 && !input.forceCancelUnpaidTest)) {
          throw new Error('PAYMENT_NOT_RESOLVED')
        }
        if (input.forceCancelUnpaidTest && currentOrder.status !== 'PENDING') {
          throw new Error('TEST_CANCELLATION_NOT_ALLOWED')
        }
      }
      const changed = await tx.order.updateMany({
        where: { id: existing.id, status: currentOrder.status },
        data: { status: input.status },
      })
      if (changed.count !== 1) throw new Error('ORDER_STATUS_CONFLICT')
      if (input.status === 'CANCELLED') {
        for (const item of currentOrder.items) {
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
          fromStatus: currentOrder.status,
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
    if (error instanceof Error && error.message === 'PAYMENT_NOT_RESOLVED') {
      res.status(409).json({ error: { code: 'PAYMENT_NOT_RESOLVED', message: 'El pago cambió mientras se cancelaba el pedido. No se modificó el stock.' } })
      return
    }
    if (error instanceof Error && error.message === 'TEST_CANCELLATION_NOT_ALLOWED') {
      res.status(409).json({ error: { code: 'TEST_CANCELLATION_NOT_ALLOWED', message: 'La cancelación excepcional solo está disponible para pedidos pendientes.' } })
      return
    }
    throw error
  }
})


adminOrdersRouter.post('/:id/refund', async (req, res) => {
  const orderId = z.string().uuid().safeParse(req.params.id)
  if (!orderId.success) {
    res.status(400).json({ error: { code: 'ORDER_ID_INVALID', message: 'El pedido no es válido.' } })
    return
  }
  if (!env.MP_ACCESS_TOKEN) {
    res.status(503).json({ error: { code: 'MP_NOT_CONFIGURED', message: 'Mercado Pago no está configurado.' } })
    return
  }

  const request = await prisma.cancellationRequest.findUnique({
    where: { orderId: orderId.data },
    include: { order: { include: { paymentAttempts: { where: { provider: 'MERCADO_PAGO' }, orderBy: { createdAt: 'desc' } } } } },
  })
  if (!request) {
    res.status(404).json({ error: { code: 'REGRET_REQUEST_NOT_FOUND', message: 'Este pedido no tiene una solicitud de arrepentimiento.' } })
    return
  }
  if (request.status === 'REFUNDED') {
    res.status(409).json({ error: { code: 'ALREADY_REFUNDED', message: 'Este pedido ya tiene un reembolso registrado.' } })
    return
  }

  const payment = request.order.paymentAttempts.find((attempt) => attempt.providerOrderId && ['APPROVED', 'PARTIALLY_REFUNDED'].includes(attempt.status))
  if (!payment?.providerOrderId) {
    res.status(409).json({ error: { code: 'APPROVED_PAYMENT_NOT_FOUND', message: 'No encontramos un pago aprobado y conciliado para este pedido.' } })
    return
  }

  try {
    // If a previous request may have reached Mercado Pago, query the order first.
    if (request.status === 'PROCESSING') {
      const check = await fetch('https://api.mercadopago.com/v1/orders/' + encodeURIComponent(payment.providerOrderId), {
        headers: { accept: 'application/json', authorization: 'Bearer ' + env.MP_ACCESS_TOKEN },
        signal: AbortSignal.timeout(15000),
      })
      if (!check.ok) throw new Error('No se pudo consultar el estado del reembolso en Mercado Pago.')
      const current = await check.json() as { status?: string; status_detail?: string; transactions?: { refunds?: Array<{ id?: string; status?: string }> } }
      if (current.status === 'refunded' || current.status_detail === 'refunded') {
        const refundId = current.transactions?.refunds?.[0]?.id || request.providerRefundId
        await prisma.$transaction([
          prisma.cancellationRequest.update({ where: { id: request.id }, data: { status: 'REFUNDED', providerRefundId: refundId || null, providerStatus: current.status || 'refunded', lastError: null } }),
          prisma.paymentAttempt.update({ where: { id: payment.id }, data: { status: 'REFUNDED', statusDetail: 'refunded', lastError: null } }),
          prisma.orderStatusHistory.create({ data: { orderId: request.orderId, fromStatus: request.order.status, toStatus: request.order.status, note: 'Reembolso total confirmado por Mercado Pago.', changedByAdminId: req.admin?.id || null } }),
        ])
        res.json({ data: { status: 'REFUNDED' }, message: 'Mercado Pago confirmó el reembolso.' })
        return
      }
      res.status(202).json({ data: { status: 'PROCESSING' }, message: 'Mercado Pago todavía está procesando el reembolso. Volvé a consultar en unos minutos.' })
      return
    }

    await prisma.cancellationRequest.update({ where: { id: request.id }, data: { status: 'PROCESSING', lastError: null } })
    const response = await fetch('https://api.mercadopago.com/v1/orders/' + encodeURIComponent(payment.providerOrderId) + '/refund', {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        authorization: 'Bearer ' + env.MP_ACCESS_TOKEN,
        'x-idempotency-key': request.requestKey,
      },
      signal: AbortSignal.timeout(20000),
    })
    const payload = await response.json().catch(() => ({})) as { id?: string; status?: string; status_detail?: string; transactions?: { refunds?: Array<{ id?: string; status?: string }> }; message?: string }
    if (!response.ok) {
      if (response.status === 409 && ['order_already_refunded', 'order_refund_already_in_process'].includes(String((payload as any).error || ''))) {
        await prisma.cancellationRequest.update({ where: { id: request.id }, data: { status: 'PROCESSING', providerStatus: 'processing', lastError: null } })
        res.status(202).json({ data: { status: 'PROCESSING' }, message: 'Mercado Pago ya tiene un reembolso en curso. Consultá nuevamente en unos minutos.' })
        return
      }
      throw new Error(payload.message || 'Mercado Pago no pudo procesar el reembolso.')
    }

    const refund = payload.transactions?.refunds?.[0]
    const completed = payload.status === 'refunded' || payload.status_detail === 'refunded'
    await prisma.cancellationRequest.update({
      where: { id: request.id },
      data: {
        status: completed ? 'REFUNDED' : 'PROCESSING',
        providerRefundId: refund?.id || null,
        providerStatus: payload.status || refund?.status || 'processing',
        lastError: null,
      },
    })
    if (completed) {
      await prisma.paymentAttempt.update({ where: { id: payment.id }, data: { status: 'REFUNDED', statusDetail: 'refunded', lastError: null } })
      await prisma.orderStatusHistory.create({ data: { orderId: request.orderId, fromStatus: request.order.status, toStatus: request.order.status, note: 'Reembolso total confirmado por Mercado Pago.', changedByAdminId: req.admin?.id || null } })
    }
    res.status(completed ? 200 : 202).json({
      data: { status: completed ? 'REFUNDED' : 'PROCESSING' },
      message: completed ? 'Mercado Pago confirmó el reembolso.' : 'Mercado Pago recibió el reembolso y lo está procesando. Consultá nuevamente en unos minutos.',
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'No se pudo procesar el reembolso.'
    await prisma.cancellationRequest.update({ where: { id: request.id }, data: { status: 'FAILED', lastError: message.slice(0, 400) } }).catch(() => undefined)
    res.status(502).json({ error: { code: 'MP_REFUND_FAILED', message } })
  }
})
