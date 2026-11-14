import { Router } from 'express'
import { PaymentAttemptStatus, Prisma } from '@prisma/client'
import { rateLimit } from 'express-rate-limit'
import { z } from 'zod'
import { env } from '../config/env'
import { prisma } from '../lib/prisma'
import { isValidPaymentCheckoutUrl, parsePaymentAmount } from '../services/payment-validation'
import { paymentAmountsMatchCurrentOrder } from '../services/payment-order-consistency'

export const goCuotasRouter = Router()
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 8, standardHeaders: 'draft-8', legacyHeaders: false })
const webhookLimiter = rateLimit({ windowMs: 60 * 1000, limit: 60, standardHeaders: 'draft-8', legacyHeaders: false })
const schema = z.object({ requestKey: z.string().uuid() })

function configured() {
  return Boolean(env.GOCUOTAS_API_BASE_URL && env.GOCUOTAS_EMAIL && env.GOCUOTAS_PASSWORD && env.PUBLIC_APP_URL && env.PUBLIC_API_URL)
}

async function authenticate() {
  if (!configured()) throw new Error('GOcuotas Sandbox no está configurado.')
  const response = await fetch(new URL('authentication', env.GOCUOTAS_API_BASE_URL!), {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({ email: env.GOCUOTAS_EMAIL, password: env.GOCUOTAS_PASSWORD }),
    signal: AbortSignal.timeout(15000),
  })
  const data = await response.json().catch(() => null) as { token?: string; message?: string } | null
  if (!response.ok || !data?.token) throw new Error('GOcuotas no pudo autenticar la sucursal (HTTP ' + response.status + ').')
  return data.token
}

async function getGoOrder(id: string, token: string) {
  const response = await fetch(new URL('orders/' + encodeURIComponent(id), env.GOCUOTAS_API_BASE_URL), {
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
    if (attempt && ['APPROVED', 'REJECTED', 'CANCELLED', 'REFUNDED'].includes(attempt.status)) return { error: 'ATTEMPT_CLOSED' as const }
    if (!attempt) attempt = await tx.paymentAttempt.create({
      data: { orderId: order.id, provider: 'GOCUOTAS', requestKey: input.data.requestKey, amountArs: order.totalArs, status: 'CREATING' },
    })
    if (attempt.status === 'PENDING' && attempt.checkoutUrl) return { order, attempt, create: false as const }
    return { order, attempt, create: true as const }
  })

  if ('error' in prepared) {
    const status = prepared.error === 'NOT_FOUND' ? 404 : 409
    res.status(status).json({ error: { code: prepared.error, message: 'No se pudo iniciar el pago con GOcuotas.' } })
    return
  }
  if (!prepared.create) {
    res.setHeader('Cache-Control', 'no-store')
    res.json({ data: { checkoutUrl: prepared.attempt.checkoutUrl, status: prepared.attempt.status } })
    return
  }

  try {
    const token = await authenticate()
    const appUrl = env.PUBLIC_APP_URL!.replace(/\/+$/, '')
    const apiUrl = env.PUBLIC_API_URL!.replace(/\/+$/, '')
    const response = await fetch(new URL('checkouts', env.GOCUOTAS_API_BASE_URL), {
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
    const payload = await response.json().catch(() => null) as { id?: number | string; url_init?: string } | null
    if (!response.ok || !payload?.id || !isValidPaymentCheckoutUrl(payload.url_init)) {
      throw new Error('GOcuotas devolvió una respuesta incompleta (HTTP ' + response.status + ').')
    }
    const attempt = await prisma.paymentAttempt.update({
      where: { id: prepared.attempt.id },
      data: {
        providerOrderId: String(payload.id),
        checkoutUrl: payload.url_init,
        status: 'PENDING',
        statusDetail: 'Checkout creado en GOcuotas',
        responsePayload: payload as Prisma.InputJsonValue,
        lastError: null,
      },
    })
    res.setHeader('Cache-Control', 'no-store')
    res.status(201).json({ data: { checkoutUrl: attempt.checkoutUrl, status: attempt.status } })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'No se pudo crear el checkout.'
    await prisma.paymentAttempt.update({ where: { id: prepared.attempt.id }, data: { status: 'UNKNOWN', lastError: message.slice(0, 500) } })
    res.status(502).json({ error: { code: 'GOCUOTAS_CHECKOUT_UNKNOWN', message: 'No pudimos confirmar la creación del checkout. Reintentá con la misma clave.' } })
  }
})

goCuotasRouter.post('/webhook', webhookLimiter, async (req, res) => {
  const id = z.union([z.string(), z.number()]).safeParse(req.body?.id ?? req.body?.order_id)
  if (!id.success) { res.status(400).send('Notificación inválida'); return }
  try {
    const token = await authenticate()
    const payload = await getGoOrder(String(id.data), token)
    const attempt = await prisma.paymentAttempt.findFirst({
      where: { provider: 'GOCUOTAS', providerOrderId: String(payload.id ?? id.data) },
      include: { order: { select: { id: true, code: true, status: true, totalArs: true } } },
    })
    if (!attempt) { res.status(503).send('Intento todavía no registrado'); return }
    const matches = payload.order_reference_id === attempt.order.code
      && parsePaymentAmount(payload.amount_in_cents) === attempt.amountArs * 100
      && paymentAmountsMatchCurrentOrder(attempt.amountArs, attempt.amountArs, attempt.order.totalArs)
    let next: PaymentAttemptStatus = 'UNKNOWN'
    if (matches && payload.delivered_at) next = 'APPROVED'
    else if (matches && payload.discarded_at) next = 'REJECTED'
    else if (matches) next = 'PENDING'
    await prisma.$transaction(async tx => {
      await tx.$queryRawUnsafe('SELECT pg_advisory_xact_lock(hashtextextended($1, 1)) IS NULL AS locked', attempt.orderId)
      const current = await tx.paymentAttempt.findUnique({ where: { id: attempt.id } })
      if (!current) return
      const effective = current.status === 'APPROVED' ? 'APPROVED' : next
      await tx.paymentAttempt.update({ where: { id: current.id }, data: {
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
    res.status(200).send('OK')
  } catch (error) {
    console.error('Error procesando webhook GOcuotas:', error)
    res.status(503).send('No se pudo verificar la notificación')
  }
})
