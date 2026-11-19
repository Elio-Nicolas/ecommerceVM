import { Router } from 'express'
import { OrderStatus, Prisma } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import { env } from '../config/env'
import { requireAdmin } from '../middleware/require-admin'
import { calculateCheckoutPrice, type CheckoutPaymentMethod } from '../services/checkout-pricing'
import { sendPaidOrderConfirmationEmail } from '../services/order-email'
import { createOcaAdmission, OcaAdmissionError } from '../services/oca-admission'
import { buildOcaAdmissionXml, OcaAdmissionXmlError } from '../services/oca-admission-xml'
import { getOcaAdmissionDate, isCompleteOcaOriginBranch, isOcaOrderPaid, matchesOcaRecipient } from '../services/oca-admission-validation'
import { getOcaAdmissionBranches } from '../services/oca-metadata'
import { getStoredOcaCredentials } from '../services/shipping-settings'

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
  shipments: { where: { provider: { in: ['OCA', 'ANDREANI'] } }, select: { provider: true, status: true, trackingNumber: true } },
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
    shippingCostArs: z.number().int().min(0).max(2_000_000_000).optional(),
    shippingCarrier: z.string().trim().max(100).nullable().optional().transform((value) => value || null),
    trackingCode: z.string().trim().max(120).nullable().optional().transform((value) => value || null),
    note: z.string().trim().max(500).optional(),
  }).parse(req.body)

  const existing = await prisma.order.findUnique({ where: { id: req.params.id } })
  if (!existing) {
    res.status(404).json({ error: { code: 'ORDER_NOT_FOUND', message: 'Pedido no encontrado.' } })
    return
  }
  if (existing.deliveryMethod === 'LOCAL_DELIVERY') {
    if (input.shippingCostArs === undefined) {
      if (existing.status === 'CANCELLED') {
        res.status(409).json({ error: { code: 'ORDER_CANCELLED', message: 'No se pueden modificar los datos de entrega de un pedido cancelado.' } })
        return
      }
      const trackingDetails = [
        input.shippingCarrier ? `Medio de entrega: ${input.shippingCarrier}` : null,
        input.trackingCode ? `Referencia: ${input.trackingCode}` : null,
        input.note ? `Observación: ${input.note}` : null,
      ].filter(Boolean).join(' · ')
      if (!trackingDetails) {
        res.status(400).json({ error: { code: 'EMPTY_DELIVERY_UPDATE', message: 'Ingresá al menos un dato para guardar.' } })
        return
      }
      const updated = await prisma.$transaction(async (tx) => {
        await tx.$queryRawUnsafe('SELECT pg_advisory_xact_lock(hashtextextended($1, 1))::text AS locked', existing.id)
        await tx.order.update({
          where: { id: existing.id },
          data: { shippingCarrier: input.shippingCarrier, trackingCode: input.trackingCode },
        })
        await tx.orderStatusHistory.create({
          data: {
            orderId: existing.id,
            fromStatus: existing.status,
            toStatus: existing.status,
            note: `Entrega local actualizada. ${trackingDetails}`,
            changedByAdminId: req.admin?.id || null,
          },
        })
        return tx.order.findUnique({ where: { id: existing.id }, include: orderInclude })
      })
      res.json({ data: updated, message: 'Datos de entrega local actualizados.' })
      return
    }
    if (existing.shippingService !== 'A coordinar') {
      res.status(409).json({ error: { code: 'SHIPPING_METHOD_NOT_SUPPORTED', message: 'El costo manual solo se puede registrar para entregas locales configuradas como A coordinar.' } })
      return
    }
    if (['SHIPPED', 'DELIVERED', 'CANCELLED'].includes(existing.status)) {
      res.status(409).json({ error: { code: 'ORDER_ALREADY_DISPATCHED', message: 'El costo de entrega local debe registrarse antes de despachar el pedido.' } })
      return
    }
    const shippingCostArs = input.shippingCostArs
    if (shippingCostArs === undefined) {
      res.status(400).json({ error: { code: 'SHIPPING_COST_REQUIRED', message: 'Ingresá el costo acordado de entrega local.' } })
      return
    }
    const totalArs = existing.subtotalArs + shippingCostArs
    if (!Number.isSafeInteger(totalArs) || totalArs > 2_000_000_000) {
      res.status(400).json({ error: { code: 'INVALID_ORDER_TOTAL', message: 'El total del pedido supera el importe permitido.' } })
      return
    }
    const updated = await prisma.$transaction(async (tx) => {
      await tx.$queryRawUnsafe('SELECT pg_advisory_xact_lock(hashtextextended($1, 1))::text AS locked', existing.id)
      const currentOrder = await tx.order.findUnique({
        where: { id: existing.id },
        select: { subtotalArs: true, shippingCostArs: true, totalArs: true, paymentMethod: true },
      })
      if (!currentOrder) return null
      const pricing = calculateCheckoutPrice({ paymentMethod: currentOrder.paymentMethod as CheckoutPaymentMethod, subtotalArs: currentOrder.subtotalArs, shippingArs: shippingCostArs, mercadoPagoSurchargeMilliPercent: env.MP_CHECKOUT_SURCHARGE_MILLIPERCENT })
      const nextTotalArs = pricing.totalArs
      if (pricing.totalArs !== currentOrder.totalArs) {
        const blockingPayment = await tx.paymentAttempt.findFirst({
          where: { orderId: existing.id, provider: { in: ['MERCADO_PAGO', 'GOCUOTAS'] }, status: { in: ['CREATING', 'PENDING', 'UNKNOWN', 'APPROVED', 'PARTIALLY_REFUNDED', 'REFUNDED'] } },
          select: { id: true },
        })
        if (blockingPayment) return null
      }
      await tx.order.update({
        where: { id: existing.id },
        data: { shippingCostArs, totalArs: nextTotalArs, paymentSurchargeMilliPercent: pricing.surchargeRateMilliPercent, paymentSurchargeArs: pricing.surchargeArs, shippingCarrier: input.shippingCarrier, trackingCode: input.trackingCode },
      })
      await tx.orderStatusHistory.create({
        data: {
          orderId: existing.id,
          fromStatus: existing.status,
          toStatus: existing.status,
          note: `Costo de entrega local coordinado: ${shippingCostArs.toLocaleString('es-AR')}.${input.shippingCarrier ? ` Medio: ${input.shippingCarrier}.` : ''}${input.trackingCode ? ` Referencia: ${input.trackingCode}.` : ''}${input.note ? ` ${input.note}` : ''}`,
          changedByAdminId: req.admin?.id || null,
        },
      })
      return tx.order.findUnique({ where: { id: existing.id }, include: orderInclude })
    })
    if (!updated) {
      res.status(409).json({ error: { code: 'PAYMENT_ALREADY_STARTED', message: 'No se puede modificar el costo de entrega porque el pedido tiene un pago iniciado o registrado. Primero resolvé el pago pendiente.' } })
      return
    }
    res.json({ data: updated, message: 'Costo de entrega local registrado.' })
    return
  }
  if (existing.status === 'CANCELLED') {
    res.status(409).json({ error: { code: 'ORDER_CANCELLED', message: 'No se puede cotizar el envío de un pedido cancelado.' } })
    return
  }
  if (!['OCA', 'ANDREANI'].includes(existing.deliveryMethod)) {
    res.status(409).json({ error: { code: 'SHIPPING_METHOD_NOT_SUPPORTED', message: 'La edición manual del costo y seguimiento está disponible únicamente para envíos nacionales OCA o Andreani.' } })
    return
  }
  const shippingCostArs = input.shippingCostArs
  if (shippingCostArs === undefined) {
    res.status(400).json({ error: { code: 'SHIPPING_COST_REQUIRED', message: 'Ingresá el precio de envío cobrado al cliente.' } })
    return
  }

  const totalArs = existing.subtotalArs + shippingCostArs
  if (!Number.isSafeInteger(totalArs) || totalArs > 2_000_000_000) {
    res.status(400).json({ error: { code: 'INVALID_ORDER_TOTAL', message: 'El total del pedido supera el importe permitido.' } })
    return
  }

  const updated = await prisma.$transaction(async (tx) => {
    await tx.$queryRawUnsafe('SELECT pg_advisory_xact_lock(hashtextextended($1, 1))::text AS locked', existing.id)
    const currentOrder = await tx.order.findUnique({
      where: { id: existing.id },
      select: { subtotalArs: true, shippingCostArs: true, totalArs: true, paymentMethod: true },
    })
    if (!currentOrder) return null
    const pricing = calculateCheckoutPrice({ paymentMethod: currentOrder.paymentMethod as CheckoutPaymentMethod, subtotalArs: currentOrder.subtotalArs, shippingArs: shippingCostArs, mercadoPagoSurchargeMilliPercent: env.MP_CHECKOUT_SURCHARGE_MILLIPERCENT })
    const nextTotalArs = pricing.totalArs
    if (pricing.totalArs !== currentOrder.totalArs) {
      const blockingPayment = await tx.paymentAttempt.findFirst({
        where: { orderId: existing.id, provider: { in: ['MERCADO_PAGO', 'GOCUOTAS'] }, status: { in: ['CREATING', 'PENDING', 'UNKNOWN', 'APPROVED', 'PARTIALLY_REFUNDED', 'REFUNDED'] } },
        select: { id: true },
      })
      if (blockingPayment) return null
    }
    await tx.order.update({
      where: { id: existing.id },
      data: {
        shippingCostArs,
        totalArs: nextTotalArs,
        paymentSurchargeMilliPercent: pricing.surchargeRateMilliPercent,
        paymentSurchargeArs: pricing.surchargeArs,
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
        note: `Envío actualizado. Costo: ${shippingCostArs.toLocaleString('es-AR')}.${trackingDetails ? ` ${trackingDetails}.` : ''}`,
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

adminOrdersRouter.post('/:id/oca-admission', async (req, res) => {
  const orderId = z.string().uuid().safeParse(req.params.id)
  const input = z.object({
    recipient: z.object({
      firstName: z.string().trim().min(1).max(30),
      lastName: z.string().trim().min(1).max(30),
      street: z.string().trim().min(1).max(30),
      number: z.string().trim().min(1).max(5),
      postalCode: z.string().regex(/^[0-9]{4}$/),
      locality: z.string().trim().min(1).max(30),
      province: z.string().trim().min(1).max(30),
      phone: z.string().trim().max(30).optional(),
      email: z.string().trim().email().max(100).optional(),
    }),
    parcel: z.object({
      heightCm: z.number().positive().max(200),
      widthCm: z.number().positive().max(200),
      lengthCm: z.number().positive().max(300),
      weightKg: z.number().positive().max(50),
    }),
  }).safeParse(req.body)
  if (!orderId.success || !input.success) {
    res.status(400).json({ error: { code: 'OCA_ADMISSION_INPUT_INVALID', message: 'Revisá los datos del destinatario y las dimensiones del bulto consolidado.' } })
    return
  }

  const order = await prisma.order.findUnique({
    where: { id: orderId.data },
    include: { items: true, paymentAttempts: { select: { provider: true, status: true, approvedAt: true } } },
  })
  if (!order) {
    res.status(404).json({ error: { code: 'ORDER_NOT_FOUND', message: 'Pedido no encontrado.' } })
    return
  }
  if (order.deliveryMethod !== 'OCA' || order.status !== 'PREPARING') {
    res.status(409).json({ error: { code: 'OCA_ADMISSION_ORDER_STATE_INVALID', message: 'La admisión OCA requiere un pedido OCA confirmado y en preparación.' } })
    return
  }
  const paid = isOcaOrderPaid(order.paymentReceivedAt, order.paymentAttempts)
  if (!paid) {
    res.status(409).json({ error: { code: 'OCA_ADMISSION_PAYMENT_REQUIRED', message: 'No se puede admitir el envío hasta que el cobro esté confirmado.' } })
    return
  }
  if (!matchesOcaRecipient(order, input.data.recipient)) {
    res.status(409).json({ error: { code: 'OCA_RECIPIENT_ADDRESS_MISMATCH', message: 'Los datos de nombre, teléfono, correo, localidad, provincia y código postal deben coincidir con el pedido.' } })
    return
  }

  const credentials = await getStoredOcaCredentials()
  if (!credentials || credentials.environment !== 'QA' || !credentials.accountNumber || !credentials.costCenter || !credentials.originBranchId) {
    res.status(503).json({ error: { code: 'OCA_ADMISSION_NOT_CONFIGURED', message: 'Configurá credenciales QA, cuenta, centro de costo y sucursal OCA de admisión antes de continuar.' } })
    return
  }
  const branches = await getOcaAdmissionBranches('5730')
  const originBranch = branches.find((item) => item.id === credentials.originBranchId) ?? null
  if (!isCompleteOcaOriginBranch(originBranch, credentials.originBranchId, '5730')) {
    res.status(409).json({ error: { code: 'OCA_ORIGIN_BRANCH_INCOMPLETE', message: 'OCA no devolvió calle, altura, localidad, provincia y CP completos para la sucursal de admisión configurada. No se usará otro domicilio.' } })
    return
  }

  const admissionDate = getOcaAdmissionDate()
  let xmlData: string
  try {
    xmlData = buildOcaAdmissionXml({
    accountNumber: credentials.accountNumber,
    operative: credentials.operative,
    orderReference: order.code,
      admissionDate,
    costCenter: credentials.costCenter,
    originBranchId: originBranch.id,
    origin: {
        street: originBranch.street,
        number: originBranch.number,
        postalCode: originBranch.postalCode!,
        locality: originBranch.locality,
        province: originBranch.province,
      },
    recipient: {
        ...input.data.recipient,
      },
    parcel: input.data.parcel,
    })
  } catch (error) {
    if (error instanceof OcaAdmissionXmlError) {
      res.status(400).json({ error: { code: 'OCA_ADMISSION_XML_INVALID', message: error.message } })
      return
    }
    throw error
  }

  const shipment = await prisma.$transaction(async (tx) => {
    await tx.$queryRawUnsafe('SELECT pg_advisory_xact_lock(hashtextextended($1, 1))::text AS locked', order.id)
    const existing = await tx.shippingShipment.findUnique({
      where: { orderId_provider: { orderId: order.id, provider: 'OCA' } },
    })
    if (existing) return null
    return tx.shippingShipment.create({
      data: {
        orderId: order.id,
        provider: 'OCA',
        status: 'ADMISSION_PENDING',
        parcels: { count: 1, ...input.data.parcel },
        events: { create: { eventType: 'ADMISSION_REQUESTED', status: 'RECEIVED', payload: { environment: 'QA', originBranchId: originBranch.id } } },
      },
    })
  })
  if (!shipment) {
    res.status(409).json({ error: { code: 'OCA_ADMISSION_ALREADY_ATTEMPTED', message: 'Ya existe un registro OCA para este pedido. No se repetirá la admisión automáticamente; verificá el resultado en e-Pak.' } })
    return
  }

  try {
    const result = await createOcaAdmission({ xmlData, confirmImmediately: false, requiredEnvironment: 'QA' })
    await prisma.$transaction(async (tx) => {
      await tx.shippingShipment.update({
        where: { id: shipment.id },
        data: {
          status: 'ADMITTED',
          externalAdmissionId: result.admissionId,
          trackingNumber: result.trackingNumber,
          admittedAt: new Date(),
          lastError: null,
        },
      })
      await tx.shippingShipmentEvent.create({
        data: {
          shipmentId: shipment.id,
          eventType: 'ADMISSION_RESPONSE',
          status: 'PROCESSED',
          payload: {
            acceptedCount: result.acceptedCount,
            rejectedCount: result.rejectedCount,
            providerStatus: result.providerStatus,
            operationCode: result.operationCode,
          },
          processedAt: new Date(),
        },
      })
    })
    res.status(201).json({
      data: { status: 'ADMITTED', admissionId: result.admissionId, trackingNumber: result.trackingNumber },
      message: 'OCA registró la admisión en QA. La confirmación final queda pendiente en e-Pak.',
    })
  } catch (error) {
    const uncertain = error instanceof OcaAdmissionError && error.uncertain
    const message = error instanceof Error ? error.message : 'No se pudo completar la admisión OCA.'
    await prisma.shippingShipment.update({
      where: { id: shipment.id },
      data: { status: uncertain ? 'ADMISSION_UNKNOWN' : 'ADMISSION_FAILED', lastError: message.slice(0, 400) },
    })
    await prisma.shippingShipmentEvent.create({
      data: {
        shipmentId: shipment.id,
        eventType: uncertain ? 'ADMISSION_RESULT_UNKNOWN' : 'ADMISSION_REJECTED',
        status: 'RECEIVED',
        payload: { message: message.slice(0, 300), uncertain },
      },
    }).catch(() => undefined)
    const statusCode = error instanceof OcaAdmissionError ? error.statusCode : 502
    res.status(statusCode).json({
      error: {
        code: uncertain ? 'OCA_ADMISSION_RESULT_UNKNOWN' : 'OCA_ADMISSION_FAILED',
        message: uncertain ? 'OCA pudo haber recibido la solicitud. No reintentes: verificá e-Pak antes de cualquier nueva acción.' : message,
      },
    })
  }
})

adminOrdersRouter.post('/:id/payment-received', async (req, res) => {
  const orderId = z.string().uuid().safeParse(req.params.id)
  const input = z.object({ note: z.string().trim().max(500).optional() }).safeParse(req.body)
  if (!orderId.success || !input.success) {
    res.status(400).json({ error: { code: 'PAYMENT_RECEIPT_INVALID', message: 'La solicitud de registro de cobro no es válida.' } })
    return
  }
  const existing = await prisma.order.findUnique({
    where: { id: orderId.data },
    select: { id: true, paymentMethod: true, status: true, paymentReceivedAt: true, totalArs: true },
  })
  if (!existing) {
    res.status(404).json({ error: { code: 'ORDER_NOT_FOUND', message: 'Pedido no encontrado.' } })
    return
  }
  if (existing.paymentMethod !== 'CASH') {
    res.status(409).json({ error: { code: 'MANUAL_PAYMENT_NOT_ALLOWED', message: 'El registro manual de cobro solo corresponde a pedidos con pago a coordinar.' } })
    return
  }
  if (existing.status === 'CANCELLED') {
    res.status(409).json({ error: { code: 'ORDER_CANCELLED', message: 'No se puede registrar un cobro para un pedido cancelado.' } })
    return
  }
  if (existing.totalArs === null) {
    res.status(409).json({ error: { code: 'ORDER_TOTAL_NOT_FINAL', message: 'Primero coordiná y registrá el costo total de entrega. Después podrás registrar el cobro completo.' } })
    return
  }
  if (existing.paymentReceivedAt) {
    await sendPaidOrderConfirmationEmail(existing.id)
    res.json({ data: { paymentReceivedAt: existing.paymentReceivedAt }, message: 'El cobro ya estaba registrado. Se intentó enviar el correo; si falla, podés reintentar desde administración.' })
    return
  }
  const receivedAt = new Date()
  const updated = await prisma.$transaction(async (tx) => {
    await tx.$queryRawUnsafe('SELECT pg_advisory_xact_lock(hashtextextended($1, 1))::text AS locked', existing.id)
    const current = await tx.order.findUnique({ where: { id: existing.id }, select: { status: true, paymentMethod: true, paymentReceivedAt: true, totalArs: true } })
    if (!current || current.status === 'CANCELLED' || current.paymentMethod !== 'CASH' || current.totalArs === null) return null
    if (current.paymentReceivedAt) return current.paymentReceivedAt
    const nextStatus = current.status === 'PENDING' ? 'CONFIRMED' : current.status
    await tx.order.update({ where: { id: existing.id }, data: { paymentReceivedAt: receivedAt, status: nextStatus } })
    await tx.orderStatusHistory.create({
      data: {
        orderId: existing.id,
        fromStatus: current.status,
        toStatus: nextStatus,
        note: input.data.note || 'Cobro en efectivo/a coordinar verificado y registrado manualmente por administración.',
        changedByAdminId: req.admin?.id || null,
      },
    })
    return receivedAt
  })
  if (!updated) {
    res.status(409).json({ error: { code: 'ORDER_PAYMENT_CONFLICT', message: 'El pedido cambió o fue cancelado. Recargá e intentá nuevamente.' } })
    return
  }
  await sendPaidOrderConfirmationEmail(existing.id)
  res.json({ data: { paymentReceivedAt: updated }, message: 'Cobro registrado. Se intentó enviar el correo de confirmación; si falla, podés reintentar desde administración.' })
})

adminOrdersRouter.patch('/:id/status', async (req, res) => {
  const input = z.object({
    status: z.nativeEnum(OrderStatus),
    note: z.string().trim().max(500).optional(),
    forceCancelUnpaidTest: z.boolean().optional(),
  }).parse(req.body)
  const existing = await prisma.order.findUnique({
    where: { id: req.params.id },
    include: { items: true, paymentAttempts: { select: { status: true, provider: true } }, shipments: { where: { provider: { in: ['OCA', 'ANDREANI'] } }, select: { provider: true, status: true, trackingNumber: true } } },
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
    const admittedShipment = existing.shipments.some((shipment) => shipment.provider === 'OCA' && shipment.status === 'PROCESSED' && Boolean(shipment.trackingNumber))
    if (!admittedShipment) {
      res.status(409).json({ error: { code: 'OCA_SHIPMENT_NOT_PROCESSED', message: 'El pedido solo puede marcarse como enviado cuando OCA confirme la admisión y exista un número de seguimiento.' } })
      return
    }
  }
  if (input.status === 'SHIPPED' && existing.deliveryMethod === 'ANDREANI') {
    const admittedShipment = existing.shipments.some((shipment) => shipment.provider === 'ANDREANI' && shipment.status === 'PROCESSED' && Boolean(shipment.trackingNumber))
    if (!admittedShipment) {
      res.status(409).json({ error: { code: 'ANDREANI_SHIPMENT_NOT_PROCESSED', message: 'El pedido solo puede marcarse como enviado cuando Andreani confirme la admisión y exista un número de seguimiento.' } })
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
      await tx.$queryRawUnsafe('SELECT pg_advisory_xact_lock(hashtextextended($1, 1))::text AS locked', existing.id)
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
