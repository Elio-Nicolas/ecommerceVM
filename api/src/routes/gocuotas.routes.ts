import { Router } from 'express'
import { PaymentAttemptStatus, Prisma } from '@prisma/client'
import { rateLimit } from 'express-rate-limit'
import { z } from 'zod'
import { env } from '../config/env'
import { prisma } from '../lib/prisma'
import { hasValidOrderAccessToken } from '../services/order-access-token'
import { isValidPaymentCheckoutUrl, parsePaymentAmount } from '../services/payment-validation'
import { paymentAmountsMatchCurrentOrder } from '../services/payment-order-consistency'
import { getGoCuotasAttemptDisposition, getGoCuotasFailureDisposition } from '../services/gocuotas-attempt-policy'
import { buildGoCuotasUrl } from '../services/gocuotas-url'
import { readGoCuotasCheckoutResponse } from '../services/gocuotas-checkout-response'
import { sendPaidOrderConfirmationEmail } from '../services/order-email'

export const goCuotasRouter = Router()
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 8, standardHeaders: 'draft-8', legacyHeaders: false })
const webhookLimiter = rateLimit({ windowMs: 60 * 1000, limit: 60, standardHeaders: 'draft-8', legacyHeaders: false })
const schema = z.object({ requestKey: z.string().uuid() })

function configured() {
  return Boolean(env.GOCUOTAS_API_BASE_URL && env.GOCUOTAS_EMAIL && env.GOCUOTAS_API_KEY && env.PUBLIC_APP_URL && env.PUBLIC_API_URL)
}

async function authenticate() {
  if (!configured()) throw new Error('GOcuotas Sandbox no está configurado.')
  const response = await fetch(buildGoCuotasUrl('authentication', env.GOCUOTAS_API_BASE_URL!), {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({ email: env.GOCUOTAS_EMAIL, password: env.GOCUOTAS_API_KEY }),
    signal: AbortSignal.timeout(15000),
  })
  const data = await response.json().catch(() => null) as { token?: string; message?: string } | null
  if (!response.ok || !data?.token) throw new Error('GOcuotas no pudo autenticar la sucursal (HTTP ' + response.status + ').')
  return data.token
}

async function getGoOrder(id: string, token: string) {
  const response = await fetch(buildGoCuotasUrl('orders/' + encodeURIComponent(id), env.GOCUOTAS_API_BASE_URL!), {
    headers: { accept: 'application/json', authorization: 'Bearer ' + token },
    signal: AbortSignal.timeout(15000),
  })
  if (!response.ok) throw new Error('GOcuotas no pudo consultar la orden (HTTP ' + response.status + ').')
  return await response.json() as {
    id?: number | string
    amount_in_cents?: number
    status?: string
    delivered_at?: string | null
    discarded_at?: string | null
    order_reference_id?: string | null
  }
}

goCuotasRouter.get('/config', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store')
  res.json({ data: { enabled: configured(), provider: 'GOCUOTAS' } })
})

goCuotasRouter.post('/orders/:orderId', limiter, async (req, res) => {
  const orderId = z.string().uuid().safeParse(req.params.orderId)
  const input = schema.safeParse(req.body)
  if (!orderId.success || !input.success) {
    res.status(400).json({ error: { code: 'PAYMENT_REQUEST_INVALID', message: 'La solicitud de pago no es válida.' } })
    return
  }
  const accessOrder = await prisma.order.findUnique({ where: { id: orderId.data }, select: { customerAccessTokenHash: true } })
  if (!accessOrder || !hasValidOrderAccessToken(req, accessOrder.customerAccessTokenHash)) {
    res.status(404).json({ error: { code: 'ORDER_NOT_FOUND', message: 'Pedido no encontrado.' } })
    return
  }
  if (!configured()) {
    res.status(503).json({ error: { code: 'GOCUOTAS_NOT_CONFIGURED', message: 'GOcuotas todavía no está configurado para Sandbox.' } })
    return
  }

  const prepared = await prisma.$transaction(async tx => {
    await tx.$queryRawUnsafe('SELECT pg_advisory_xact_lock(hashtextextended($1, 1)) IS NULL AS locked', orderId.data)
    const order = await tx.order.findUnique({ where: { id: orderId.data }, include: { items: true } })
    if (!order) return { error: 'NOT_FOUND' as const }
    if (order.paymentMethod !== 'GOCUOTAS') return { error: 'PAYMENT_METHOD_MISMATCH' as const }
    if (!['PENDING', 'CONFIRMED'].includes(order.status) || !order.totalArs || !order.customerEmail) return { error: 'ORDER_NOT_PAYABLE' as const }
    const paid = await tx.paymentAttempt.findFirst({ where: { orderId: order.id, status: 'APPROVED' } })
    if (paid) return { error: 'ALREADY_PAID' as const }
    let attempt = await tx.paymentAttempt.findUnique({ where: { requestKey: input.data.requestKey } })
    if (attempt && (attempt.orderId !== order.id || attempt.provider !== 'GOCUOTAS')) return { error: 'REQUEST_KEY_CONFLICT' as const }
    if (attempt && ['APPROVED', 'REJECTED', 'CANCELLED', 'REFUNDED', 'PARTIALLY_REFUNDED'].includes(attempt.status)) return { error: 'ATTEMPT_CLOSED' as const }

    if (!attempt) {
      const active = await tx.paymentAttempt.findFirst({
        where: { orderId: order.id, provider: 'GOCUOTAS', status: { in: ['CREATING', 'PENDING', 'UNKNOWN'] } },
        orderBy: { createdAt: 'desc' },
      })
      if (active) {
        if (active.amountArs !== order.totalArs) return { error: 'ATTEMPT_AMOUNT_CHANGED' as const }
        if (getGoCuotasAttemptDisposition(active) === 'REUSE_CHECKOUT') {
          return { order, attempt: active, create: false as const }
        }
        return { error: active.status === 'UNKNOWN' ? 'CHECKOUT_UNKNOWN' as const : 'CHECKOUT_IN_PROGRESS' as const }
      }
      attempt = await tx.paymentAttempt.create({
        data: { orderId: order.id, provider: 'GOCUOTAS', requestKey: input.data.requestKey, amountArs: order.totalArs, status: 'CREATING' },
      })
      return { order, attempt, create: true as const }
    }

    if (attempt.amountArs !== order.totalArs) return { error: 'ATTEMPT_AMOUNT_CHANGED' as const }
    if (getGoCuotasAttemptDisposition(attempt) === 'REUSE_CHECKOUT') {
      return { order, attempt, create: false as const }
    }
    return { error: attempt.status === 'UNKNOWN' ? 'CHECKOUT_UNKNOWN' as const : 'CHECKOUT_IN_PROGRESS' as const }
  })

  if ('error' in prepared) {
    const errors: Record<string, { status: number; message: string }> = {
      NOT_FOUND: { status: 404, message: 'Pedido no encontrado.' },
      PAYMENT_METHOD_MISMATCH: { status: 409, message: 'El pedido no está configurado para pagar con GOcuotas.' },
      ORDER_NOT_PAYABLE: { status: 409, message: 'El pedido todavía no está disponible para pagar.' },
      ALREADY_PAID: { status: 409, message: 'Este pedido ya tiene un pago aprobado.' },
      REQUEST_KEY_CONFLICT: { status: 409, message: 'La clave de pago ya fue utilizada para otra operación.' },
      ATTEMPT_CLOSED: { status: 409, message: 'El intento anterior quedó cerrado. Revisá el estado del pedido antes de iniciar otro pago.' },
      CHECKOUT_UNKNOWN: { status: 409, message: 'GOcuotas podría haber creado el checkout, pero no pudimos confirmar la respuesta. No generes otro pago; estamos verificando la operación.' },
      CHECKOUT_IN_PROGRESS: { status: 409, message: 'Ya hay una solicitud de pago en proceso. Esperá unos instantes y consultá nuevamente el estado.' },
      ATTEMPT_AMOUNT_CHANGED: { status: 409, message: 'El importe del pedido cambió desde el intento anterior. Contactá a la tienda para verificarlo antes de pagar.' },
    }
    const errorCode = String(prepared.error || 'UNKNOWN')
    const error = errors[errorCode] || { status: 409, message: 'No se pudo iniciar el pago con GOcuotas.' }
    res.status(error.status).json({ error: { code: errorCode, message: error.message } })
    return
  }
  if (!prepared.create) {
    res.setHeader('Cache-Control', 'no-store')
    res.json({ data: { checkoutUrl: prepared.attempt.checkoutUrl, status: prepared.attempt.status } })
    return
  }

  let checkoutRequestStarted = false
  try {
    const token = await authenticate()
    const appUrl = env.PUBLIC_APP_URL!.replace(/\/+$/, '')
    const apiUrl = env.PUBLIC_API_URL!.replace(/\/+$/, '')
    checkoutRequestStarted = true
    const response = await fetch(buildGoCuotasUrl('checkouts', env.GOCUOTAS_API_BASE_URL!), {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json', authorization: 'Bearer ' + token },
      body: JSON.stringify({
        amount_in_cents: prepared.order.totalArs! * 100,
        url_success: appUrl + '/?payment=success&provider=gocuotas&order=' + encodeURIComponent(prepared.order.id),
        url_failure: appUrl + '/?payment=failure&provider=gocuotas&order=' + encodeURIComponent(prepared.order.id),
        order_reference_id: prepared.order.code,
        webhook_url: apiUrl + '/api/v1/payments/gocuotas/webhook',
        email: prepared.order.customerEmail,
        phone_number: prepared.order.customerPhone,
      }),
      signal: AbortSignal.timeout(20000),
    })
    const checkoutResponse = await readGoCuotasCheckoutResponse(response)
    const payload = checkoutResponse.payload
    const providerOrderId = payload?.id != null && String(payload.id).trim() !== '' ? String(payload.id) : null
    if (!response.ok || !isValidPaymentCheckoutUrl(payload?.url_init)) {
      throw new Error('Respuesta de checkout no reconocida: ' + checkoutResponse.diagnostic)
    }
    const attempt = await prisma.$transaction(async tx => {
      await tx.$queryRawUnsafe('SELECT pg_advisory_xact_lock(hashtextextended($1, 1)) IS NULL AS locked', prepared.order.id)
      const current = await tx.paymentAttempt.findUnique({ where: { id: prepared.attempt.id } })
      if (!current) throw new Error('El intento de pago dejó de existir.')
      if (providerOrderId && current.providerOrderId && current.providerOrderId !== providerOrderId) {
        throw new Error('GOcuotas devolvió un identificador distinto al asociado al intento.')
      }
      return tx.paymentAttempt.update({
        where: { id: current.id },
        data: {
          providerOrderId: current.providerOrderId || providerOrderId,
          checkoutUrl: payload.url_init,
          // A webhook may have approved the order while the checkout response was in flight.
          status: current.status === 'APPROVED' ? 'APPROVED' : 'PENDING',
          statusDetail: current.status === 'APPROVED' ? current.statusDetail : 'Checkout creado en GOcuotas',
          responsePayload: payload as Prisma.InputJsonValue,
          lastError: null,
        },
      })
    })
    res.setHeader('Cache-Control', 'no-store')
    res.status(201).json({ data: { checkoutUrl: attempt.checkoutUrl, status: attempt.status } })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'No se pudo crear el checkout.'
    if (getGoCuotasFailureDisposition(checkoutRequestStarted) === 'RELEASE_ATTEMPT') {
      await prisma.paymentAttempt.deleteMany({ where: { id: prepared.attempt.id, status: 'CREATING' } })
      res.status(502).json({ error: { code: 'GOCUOTAS_AUTHENTICATION_FAILED', message: 'No pudimos autenticar con GOcuotas. Podés volver a intentarlo.' } })
      return
    }
    await prisma.$transaction(async tx => {
      await tx.$queryRawUnsafe('SELECT pg_advisory_xact_lock(hashtextextended($1, 1)) IS NULL AS locked', prepared.order.id)
      const current = await tx.paymentAttempt.findUnique({ where: { id: prepared.attempt.id } })
      if (current && current.status !== 'APPROVED') {
        await tx.paymentAttempt.update({ where: { id: current.id }, data: { status: 'UNKNOWN', lastError: message.slice(0, 500) } })
      }
    })
    res.status(502).json({ error: { code: 'GOCUOTAS_CHECKOUT_UNKNOWN', message: 'No pudimos confirmar la creación del checkout. No vuelvas a intentar el pago mientras verificamos la operación.' } })
  }
})

goCuotasRouter.post('/webhook', webhookLimiter, async (req, res) => {
  const body = req.body as unknown
  const bodyIsRecord = body !== null && typeof body === 'object' && !Array.isArray(body)
  const bodyKeys = bodyIsRecord ? Object.keys(body as Record<string, unknown>).slice(0, 20).sort() : []
  const candidateId = bodyIsRecord
    ? (body as Record<string, unknown>).id ?? (body as Record<string, unknown>).order_id
    : undefined
  const id = z.union([z.string(), z.number()]).safeParse(candidateId)
  if (!id.success) {
    // Log shape only: never log webhook values, customer data, headers, or secrets.
    console.warn('[GOcuotas webhook] Notificación sin identificador reconocido.', JSON.stringify({
      contentType: req.get('content-type')?.split(';', 1)[0] || 'unknown',
      bodyType: body === null ? 'null' : Array.isArray(body) ? 'array' : typeof body,
      bodyKeys,
      idFieldType: bodyIsRecord && 'id' in (body as Record<string, unknown>) ? typeof (body as Record<string, unknown>).id : 'missing',
      orderIdFieldType: bodyIsRecord && 'order_id' in (body as Record<string, unknown>) ? typeof (body as Record<string, unknown>).order_id : 'missing',
    }))
    res.status(400).send('Notificación inválida')
    return
  }
  console.info('[GOcuotas webhook] Notificación recibida.')
  try {
    const token = await authenticate()
    const payload = await getGoOrder(String(id.data), token)
    const providerOrderId = String(payload.id ?? id.data)
    let attempt = await prisma.paymentAttempt.findFirst({
      where: { provider: 'GOCUOTAS', providerOrderId },
      include: { order: { select: { id: true, code: true, status: true, totalArs: true } } },
    })

    // A webhook can arrive before the checkout request has persisted the provider ID
    // (for example, when the checkout response times out). Correlate only by the
    // unique order reference generated by this API and only to an unlinked attempt.
    if (!attempt && typeof payload.order_reference_id === 'string' && payload.order_reference_id.length > 0) {
      const order = await prisma.order.findUnique({
        where: { code: payload.order_reference_id },
        select: { id: true },
      })
      if (order) {
        attempt = await prisma.paymentAttempt.findFirst({
          where: {
            orderId: order.id,
            provider: 'GOCUOTAS',
            providerOrderId: null,
            status: { in: ['CREATING', 'UNKNOWN', 'PENDING'] },
          },
          include: { order: { select: { id: true, code: true, status: true, totalArs: true } } },
        })
      }
    }
    if (!attempt) { res.status(503).send('Intento todavía no registrado'); return }
    const matches = payload.order_reference_id === attempt.order.code
      && parsePaymentAmount(payload.amount_in_cents) === attempt.amountArs * 100
      && paymentAmountsMatchCurrentOrder(attempt.amountArs, attempt.amountArs, attempt.order.totalArs)
    // GOcuotas may report the final result through status without setting
    // delivered_at/discarded_at. Accept only the documented terminal values,
    // and keep the exact reference + amount checks above as mandatory guards.
    const providerStatus = String(payload.status || '').trim().toLowerCase()
    let next: PaymentAttemptStatus = 'UNKNOWN'
    if (matches && (payload.delivered_at || providerStatus === 'approved')) next = 'APPROVED'
    else if (matches && (payload.discarded_at || providerStatus === 'denied')) next = 'REJECTED'
    else if (matches) next = 'PENDING'
    await prisma.$transaction(async tx => {
      await tx.$queryRawUnsafe('SELECT pg_advisory_xact_lock(hashtextextended($1, 1)) IS NULL AS locked', attempt.orderId)
      const current = await tx.paymentAttempt.findUnique({ where: { id: attempt.id } })
      if (!current) return
      const effective = current.status === 'APPROVED' ? 'APPROVED' : next
      await tx.paymentAttempt.update({ where: { id: current.id }, data: {
        providerOrderId: current.providerOrderId || providerOrderId,
        status: effective,
        statusDetail: String(payload.status || (payload.delivered_at ? 'delivered' : payload.discarded_at ? 'discarded' : 'pending')).slice(0, 200),
        responsePayload: payload as Prisma.InputJsonValue,
        approvedAt: effective === 'APPROVED' ? current.approvedAt || new Date() : current.approvedAt,
        lastError: matches ? null : 'La orden notificada no coincide con la referencia o el importe del pedido.',
      } })
      if (matches && effective === 'APPROVED' && attempt.order.status === 'PENDING') {
        const changed = await tx.order.updateMany({ where: { id: attempt.orderId, status: 'PENDING', totalArs: attempt.amountArs }, data: { status: 'CONFIRMED' } })
        if (changed.count === 1) await tx.orderStatusHistory.create({ data: { orderId: attempt.orderId, fromStatus: 'PENDING', toStatus: 'CONFIRMED', note: 'Pago aprobado por GOcuotas. Orden ' + String(id.data) + '.' } })
      }
    })
    const approved = await prisma.paymentAttempt.findUnique({
      where: { id: attempt.id },
      select: { status: true, order: { select: { id: true, status: true } } },
    })
    if (approved?.status === 'APPROVED' && approved.order.status === 'CONFIRMED') {
      await sendPaidOrderConfirmationEmail(approved.order.id)
    }
    res.status(200).send('OK')
  } catch (error) {
    console.error('Error procesando webhook GOcuotas:', error)
    res.status(503).send('No se pudo verificar la notificación')
  }
})
