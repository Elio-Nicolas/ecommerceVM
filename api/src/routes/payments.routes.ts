import { createHmac, timingSafeEqual } from 'node:crypto'
import { Router } from 'express'
import { PaymentAttemptStatus, Prisma } from '@prisma/client'
import { rateLimit } from 'express-rate-limit'
import { z } from 'zod'
import { env } from '../config/env'
import { prisma } from '../lib/prisma'
import { requireAdmin } from '../middleware/require-admin'
import { isValidPaymentCheckoutUrl, parsePaymentAmount } from '../services/payment-validation'

export const paymentsRouter = Router()

const createPaymentLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 8, standardHeaders: 'draft-8', legacyHeaders: false })
const statusLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 300, standardHeaders: 'draft-8', legacyHeaders: false })
const webhookLimiter = rateLimit({ windowMs: 60 * 1000, limit: 60, standardHeaders: 'draft-8', legacyHeaders: false })
const paymentInputSchema = z.object({ requestKey: z.string().uuid() })

function paymentConfiguration() {
  return {
    enabled: Boolean(env.MP_ACCESS_TOKEN && env.MP_WEBHOOK_SECRET && env.PUBLIC_APP_URL && env.PUBLIC_API_URL),
    provider: 'MERCADO_PAGO' as const,
  }
}

function toAmount(value: number) {
  return value.toFixed(2)
}

async function createMercadoPagoOrder(input: {
  order: {
    id: string
    code: string
    customerEmail: string
    totalArs: number
    items: Array<{ productName: string; quantity: number; unitPriceArs: number }>
    shippingCostArs: number | null
    shippingCarrier: string | null
  }
  requestKey: string
}) {
  if (!env.MP_ACCESS_TOKEN || !env.PUBLIC_APP_URL || !env.PUBLIC_API_URL) {
    throw new Error('Falta configurar Mercado Pago y las URLs públicas de retorno.')
  }

  const items = input.order.items.map((item) => ({
    title: item.productName.slice(0, 250),
    quantity: item.quantity,
    unit_price: toAmount(item.unitPriceArs),
  }))
  if (input.order.shippingCostArs && input.order.shippingCostArs > 0) {
    items.push({
      title: ('Envío · ' + (input.order.shippingCarrier || 'Entrega')).slice(0, 250),
      quantity: 1,
      unit_price: toAmount(input.order.shippingCostArs),
    })
  }

  const appUrl = env.PUBLIC_APP_URL.replace(/\/+$/, '')
  const body = {
    type: 'online',
    processing_mode: 'manual',
    capture_mode: 'automatic_async',
    expiration_time: 'PT30M',
    total_amount: toAmount(input.order.totalArs),
    external_reference: input.order.code,
    description: 'Pedido ' + input.order.code,
    payer: { email: input.order.customerEmail },
    items,
    config: {
      online: {
        success_url: appUrl + '/?payment=success&order=' + encodeURIComponent(input.order.id),
        failure_url: appUrl + '/?payment=failure&order=' + encodeURIComponent(input.order.id),
        pending_url: appUrl + '/?payment=pending&order=' + encodeURIComponent(input.order.id),
        auto_return: 'approved',
      },
    },
  }

  let response: Response
  try {
    response = await fetch('https://api.mercadopago.com/v1/orders', {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        authorization: 'Bearer ' + env.MP_ACCESS_TOKEN,
        'x-idempotency-key': input.requestKey,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20000),
    })
  } catch {
    throw new Error('No se pudo conectar con Mercado Pago. Podés reintentar sin generar otro cobro.')
  }

  const payload = await response.json().catch(() => null) as {
    id?: string
    checkout_url?: string
    external_reference?: string
    total_amount?: string | number
    currency?: string
    status?: string
    status_detail?: string
    message?: string
    error?: string
  } | null

  if (!response.ok) {
    const message = payload?.message || payload?.error || ('Mercado Pago respondió HTTP ' + response.status + '.')
    throw new Error(String(message).slice(0, 350))
  }
  if (
    !payload?.id
    || !isValidPaymentCheckoutUrl(payload.checkout_url)
    || payload.external_reference !== input.order.code
    || parsePaymentAmount(payload.total_amount) !== input.order.totalArs
    || payload.currency !== 'ARS'
  ) {
    throw new Error('Mercado Pago devolvió una orden de pago incompleta o con datos distintos al pedido.')
  }
  return payload
}

async function refreshMercadoPagoOrder(providerOrderId: string) {
  if (!env.MP_ACCESS_TOKEN) throw new Error('Mercado Pago no está configurado.')
  const response = await fetch('https://api.mercadopago.com/v1/orders/' + encodeURIComponent(providerOrderId), {
    headers: { accept: 'application/json', authorization: 'Bearer ' + env.MP_ACCESS_TOKEN },
    signal: AbortSignal.timeout(15000),
  })
  if (!response.ok) throw new Error('No se pudo consultar la orden de Mercado Pago (HTTP ' + response.status + ').')
  return await response.json() as {
    id?: string
    status?: string
    status_detail?: string
    external_reference?: string
    total_amount?: string | number
    total_paid_amount?: string | number
    currency?: string
  }
}

function verifyWebhookSignature(signature: string, requestId: string, dataId: string) {
  if (!env.MP_WEBHOOK_SECRET) return false
  const parts = new Map(signature.split(',').map((part) => {
    const [key, ...rest] = part.trim().split('=')
    return [key, rest.join('=')]
  }))
  const timestamp = parts.get('ts')
  const receivedHash = parts.get('v1')
  if (!timestamp || !receivedHash || !/^[a-f0-9]{64}$/i.test(receivedHash)) return false
  const rawTimestamp = Number(timestamp)
  if (!Number.isFinite(rawTimestamp)) return false
  const timestampMs = rawTimestamp > 1_000_000_000_000 ? rawTimestamp : rawTimestamp * 1000
  if (Math.abs(Date.now() - timestampMs) > 5 * 60 * 1000) return false
  const manifest = 'id:' + dataId + ';request-id:' + requestId + ';ts:' + timestamp + ';'
  const expectedHash = createHmac('sha256', env.MP_WEBHOOK_SECRET).update(manifest).digest()
  const suppliedHash = Buffer.from(receivedHash, 'hex')
  return suppliedHash.length === expectedHash.length && timingSafeEqual(suppliedHash, expectedHash)
}

async function applyMercadoPagoStatus(providerOrderId: string, payload: Awaited<ReturnType<typeof refreshMercadoPagoOrder>>) {
  const attempt = await prisma.paymentAttempt.findUnique({
    where: { providerOrderId },
  })
  if (!attempt) return false
  const order = await prisma.order.findUnique({ where: { id: attempt.orderId }, select: { code: true } })
  if (!order) return false

  const paidAmount = parsePaymentAmount(payload.total_paid_amount)
  const totalAmount = parsePaymentAmount(payload.total_amount)
  const matchesOrder = payload.id === providerOrderId
    && payload.external_reference === order.code
    && payload.currency === 'ARS'
    && totalAmount === attempt.amountArs

  let nextStatus: PaymentAttemptStatus = 'UNKNOWN'
  if (matchesOrder && payload.status === 'processed' && payload.status_detail === 'partially_refunded') {
    nextStatus = 'PARTIALLY_REFUNDED'
  } else if (matchesOrder && payload.status === 'processed' && paidAmount === attempt.amountArs) {
    nextStatus = 'APPROVED'
  } else if (matchesOrder && payload.status === 'refunded') {
    nextStatus = 'REFUNDED'
  } else if (matchesOrder && payload.status === 'canceled') {
    nextStatus = 'CANCELLED'
  } else if (matchesOrder && payload.status === 'failed') {
    nextStatus = 'REJECTED'
  } else if (matchesOrder && ['created', 'processing'].includes(String(payload.status))) {
    nextStatus = 'PENDING'
  }

  await prisma.$transaction(async (tx) => {
    const current = await tx.paymentAttempt.findUnique({ where: { id: attempt.id } })
    if (!current) return
    const terminalPaymentStatuses: PaymentAttemptStatus[] = ['REFUNDED', 'CANCELLED', 'REJECTED']
    const effectiveStatus = current.status === 'REFUNDED'
      ? 'REFUNDED'
      : current.status === 'PARTIALLY_REFUNDED' && nextStatus !== 'REFUNDED'
        ? 'PARTIALLY_REFUNDED'
        : current.status === 'APPROVED' && !['REFUNDED', 'PARTIALLY_REFUNDED', 'CANCELLED'].includes(nextStatus)
          ? 'APPROVED'
          : terminalPaymentStatuses.includes(current.status) && ['PENDING', 'UNKNOWN'].includes(nextStatus)
            ? current.status
            : nextStatus
    await tx.paymentAttempt.update({
      where: { id: current.id },
      data: {
        status: effectiveStatus,
        statusDetail: String(payload.status_detail || payload.status || 'Estado no informado').slice(0, 200),
        responsePayload: payload as Prisma.InputJsonValue,
        approvedAt: effectiveStatus === 'APPROVED' ? current.approvedAt || new Date() : current.approvedAt,
        lastError: matchesOrder ? null : 'La respuesta de Mercado Pago no coincide con el pedido o su importe.',
      },
    })

    const currentOrder = await tx.order.findUnique({ where: { id: attempt.orderId }, select: { status: true } })
    if (effectiveStatus === 'APPROVED' && currentOrder?.status === 'PENDING') {
      const changed = await tx.order.updateMany({
        where: { id: attempt.orderId, status: 'PENDING' },
        data: { status: 'CONFIRMED' },
      })
      if (changed.count === 1) {
        await tx.orderStatusHistory.create({
          data: {
            orderId: attempt.orderId,
            fromStatus: 'PENDING',
            toStatus: 'CONFIRMED',
            note: 'Pago aprobado por Mercado Pago. Orden ' + providerOrderId + '.',
          },
        })
      }
    } else if (effectiveStatus === 'APPROVED' && currentOrder?.status === 'CANCELLED' && current.status !== 'APPROVED') {
      await tx.orderStatusHistory.create({
        data: {
          orderId: attempt.orderId,
          fromStatus: 'CANCELLED',
          toStatus: 'CANCELLED',
          note: 'ATENCIÓN: Mercado Pago informó un pago aprobado para un pedido cancelado. Orden ' + providerOrderId + '; requiere revisión manual.',
        },
      })
    }
  })
  return true
}

paymentsRouter.get('/config', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store')
  res.json({ data: paymentConfiguration() })
})

paymentsRouter.post('/orders/:orderId', createPaymentLimiter, async (req, res) => {
  const orderId = z.string().uuid().safeParse(req.params.orderId)
  const input = paymentInputSchema.safeParse(req.body)
  if (!orderId.success || !input.success) {
    res.status(400).json({ error: { code: 'PAYMENT_REQUEST_INVALID', message: 'La solicitud de pago no es válida.' } })
    return
  }
  if (!paymentConfiguration().enabled) {
    res.status(503).json({ error: { code: 'PAYMENTS_NOT_CONFIGURED', message: 'Los pagos online todavía no están configurados.' } })
    return
  }

  const prepared = await prisma.$transaction(async (tx) => {
    await tx.$queryRawUnsafe('SELECT pg_advisory_xact_lock(hashtextextended($1, 1))', orderId.data)
    const order = await tx.order.findUnique({
      where: { id: orderId.data },
      include: { items: true },
    })
    if (!order) return { error: 'NOT_FOUND' as const }
    if (order.status !== 'PENDING') return { error: 'ORDER_NOT_PAYABLE' as const }
    if (!order.customerEmail) return { error: 'EMAIL_REQUIRED' as const }
    if (!order.totalArs || order.totalArs <= 0) return { error: 'TOTAL_NOT_FINAL' as const }

    const approvedAttempt = await tx.paymentAttempt.findFirst({
      where: { orderId: order.id, status: 'APPROVED' },
      select: { id: true },
    })
    if (approvedAttempt) return { error: 'ALREADY_PAID' as const }

    let attempt = await tx.paymentAttempt.findUnique({ where: { requestKey: input.data.requestKey } })
    if (attempt && attempt.orderId !== order.id) return { error: 'REQUEST_KEY_CONFLICT' as const }
    if (attempt && ['APPROVED', 'REJECTED', 'CANCELLED', 'REFUNDED', 'PARTIALLY_REFUNDED'].includes(attempt.status)) {
      return { error: attempt.status === 'APPROVED' ? 'ALREADY_PAID' as const : 'ATTEMPT_CLOSED' as const }
    }

    if (!attempt) {
      const active = await tx.paymentAttempt.findFirst({
        where: { orderId: order.id, status: { in: ['CREATING', 'PENDING', 'UNKNOWN'] } },
        orderBy: { createdAt: 'desc' },
      })
      if (active) attempt = active
      else {
        attempt = await tx.paymentAttempt.create({
          data: {
            orderId: order.id,
            requestKey: input.data.requestKey,
            amountArs: order.totalArs,
            status: 'CREATING',
          },
        })
      }
    }

    if (attempt.status === 'PENDING' && attempt.checkoutUrl) {
      return { order, attempt, shouldCreate: false as const }
    }
    return { order, attempt, shouldCreate: true as const }
  })

  if ('error' in prepared) {
    const errors: Record<string, { status: number; message: string }> = {
      NOT_FOUND: { status: 404, message: 'Pedido no encontrado.' },
      ORDER_NOT_PAYABLE: { status: 409, message: 'El pedido ya no está pendiente de pago.' },
      EMAIL_REQUIRED: { status: 409, message: 'Ingresá un correo electrónico válido para pagar con Mercado Pago.' },
      TOTAL_NOT_FINAL: { status: 409, message: 'El total todavía no está confirmado. Coordiná primero el costo de entrega.' },
      REQUEST_KEY_CONFLICT: { status: 409, message: 'La clave de pago ya fue utilizada para otro pedido.' },
      ALREADY_PAID: { status: 409, message: 'Este pedido ya tiene un pago aprobado.' },
      ATTEMPT_CLOSED: { status: 409, message: 'El intento anterior quedó cerrado. Iniciá un nuevo intento de pago.' },
    }
    const errorCode = String(prepared.error || 'UNKNOWN')
    const error = errors[errorCode] || { status: 500, message: 'No se pudo preparar el pago.' }
    res.status(error.status).json({ error: { code: errorCode, message: error.message } })
    return
  }

  if (!prepared.shouldCreate) {
    res.setHeader('Cache-Control', 'no-store')
    res.json({ data: { checkoutUrl: prepared.attempt.checkoutUrl, status: prepared.attempt.status } })
    return
  }

  try {
    const providerOrder = await createMercadoPagoOrder({
      order: {
        id: prepared.order.id,
        code: prepared.order.code,
        customerEmail: prepared.order.customerEmail!,
        totalArs: prepared.order.totalArs!,
        items: prepared.order.items,
        shippingCostArs: prepared.order.shippingCostArs,
        shippingCarrier: prepared.order.shippingCarrier,
      },
      requestKey: prepared.attempt.requestKey,
    })
    const attempt = await prisma.paymentAttempt.update({
      where: { id: prepared.attempt.id },
      data: {
        providerOrderId: providerOrder.id,
        checkoutUrl: providerOrder.checkout_url,
        status: 'PENDING',
        statusDetail: String(providerOrder.status_detail || providerOrder.status || 'created').slice(0, 200),
        responsePayload: providerOrder as Prisma.InputJsonValue,
        lastError: null,
      },
    })
    res.setHeader('Cache-Control', 'no-store')
    res.status(201).json({ data: { checkoutUrl: attempt.checkoutUrl, status: attempt.status } })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'No se pudo crear el pago.'
    await prisma.paymentAttempt.update({
      where: { id: prepared.attempt.id },
      data: { status: 'UNKNOWN', lastError: message.slice(0, 500) },
    })
    res.status(502).json({
      error: {
        code: 'PAYMENT_CREATION_UNKNOWN',
        message: 'No pudimos confirmar la creación del pago. Reintentá con el mismo pedido; no se generará un cobro duplicado.',
      },
    })
  }
})

paymentsRouter.get('/orders/:orderId/status', statusLimiter, async (req, res) => {
  const orderId = z.string().uuid().safeParse(req.params.orderId)
  if (!orderId.success) {
    res.status(404).json({ error: { code: 'ORDER_NOT_FOUND', message: 'Pedido no encontrado.' } })
    return
  }
  const order = await prisma.order.findUnique({
    where: { id: orderId.data },
    select: {
      code: true,
      status: true,
      paymentAttempts: {
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { status: true, statusDetail: true, amountArs: true, approvedAt: true },
      },
    },
  })
  if (!order) {
    res.status(404).json({ error: { code: 'ORDER_NOT_FOUND', message: 'Pedido no encontrado.' } })
    return
  }
  res.setHeader('Cache-Control', 'no-store')
  res.json({
    data: {
      code: order.code,
      orderStatus: order.status,
      payment: order.paymentAttempts[0] || null,
    },
  })
})

paymentsRouter.post('/admin/orders/:orderId/attempts/:attemptId/reconcile', requireAdmin, async (req, res) => {
  const orderId = z.string().uuid().safeParse(req.params.orderId)
  const attemptId = z.string().uuid().safeParse(req.params.attemptId)
  if (!orderId.success || !attemptId.success) {
    res.status(400).json({ error: { code: 'PAYMENT_ATTEMPT_INVALID', message: 'El intento de pago no es válido.' } })
    return
  }
  const attempt = await prisma.paymentAttempt.findFirst({
    where: { id: attemptId.data, orderId: orderId.data, provider: 'MERCADO_PAGO' },
  })
  if (!attempt) {
    res.status(404).json({ error: { code: 'PAYMENT_ATTEMPT_NOT_FOUND', message: 'No se encontró el intento de pago.' } })
    return
  }
  if (!attempt.providerOrderId) {
    res.status(409).json({ error: { code: 'PAYMENT_ORDER_ID_MISSING', message: 'Mercado Pago todavía no devolvió un identificador de orden. Reintentá la creación con la misma clave desde el checkout.' } })
    return
  }
  try {
    const payload = await refreshMercadoPagoOrder(attempt.providerOrderId)
    await applyMercadoPagoStatus(attempt.providerOrderId, payload)
    const updated = await prisma.paymentAttempt.findUnique({
      where: { id: attempt.id },
      select: { id: true, status: true, statusDetail: true, amountArs: true, approvedAt: true, providerOrderId: true },
    })
    res.setHeader('Cache-Control', 'no-store')
    res.json({ data: updated, message: 'Estado consultado directamente en Mercado Pago.' })
  } catch (error) {
    console.error('No se pudo conciliar el pago desde administración:', error)
    res.status(503).json({ error: { code: 'PAYMENT_RECONCILIATION_FAILED', message: 'No se pudo consultar Mercado Pago. Intentá nuevamente más tarde.' } })
  }
})

paymentsRouter.post('/webhook', webhookLimiter, async (req, res) => {
  const dataId = z.string().trim().min(1).max(80).safeParse(req.query['data.id'])
  const type = z.string().trim().safeParse(req.query.type)
  const signature = req.header('x-signature')
  const requestId = req.header('x-request-id')
  if (!dataId.success || !type.success || type.data !== 'order') {
    res.status(400).send('Notificación inválida')
    return
  }
  if (!signature || !requestId || !verifyWebhookSignature(signature, requestId, dataId.data)) {
    res.status(401).send('Firma inválida')
    return
  }

  try {
    const payload = await refreshMercadoPagoOrder(dataId.data)
    const applied = await applyMercadoPagoStatus(dataId.data, payload)
    if (!applied) {
      console.warn('Webhook de Mercado Pago recibido antes de registrar el intento:', dataId.data)
      res.status(503).send('El intento de pago todavía no está registrado; reintentá la notificación.')
      return
    }
    res.status(200).send('OK')
  } catch (error) {
    console.error('No se pudo procesar el webhook de Mercado Pago:', error)
    res.status(503).send('No se pudo procesar la notificación')
  }
})
