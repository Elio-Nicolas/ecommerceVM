import { Router } from 'express'
import { rateLimit } from 'express-rate-limit'
import { z } from 'zod'
import { FiscalDocumentStatus, FiscalDocumentType, Prisma } from '@prisma/client'
import type { ArcaEnvironment } from '@prisma/client'
import { env } from '../config/env'
import { prisma } from '../lib/prisma'
import { requireAdmin } from '../middleware/require-admin'
import { getArcaAccessTicket } from '../services/arca-wsaa'
import { getArcaIvaReceiverConditions, getArcaLastAuthorizedVoucher, getArcaPointsOfSale, getArcaVoucherTypes } from '../services/arca-wsfe-readonly'
import { buildArcaInvoiceCRequestPayload, requestArcaInvoiceC } from '../services/arca-wsfe-issue'

export const adminArcaRouter = Router()
adminArcaRouter.use(requireAdmin)

const settingsResponse = (settings: { enabled: boolean; environment: ArcaEnvironment; pointOfSale: number | null }) => ({
  enabled: settings.enabled,
  environment: settings.environment,
  pointOfSale,
  cuitConfigured: Boolean(env.ARCA_CUIT),
  certificateConfigured: Boolean(env.ARCA_CERTIFICATE_PATH && env.ARCA_PRIVATE_KEY_PATH),
  credentialsConfigured: Boolean(env.ARCA_CUIT && env.ARCA_CERTIFICATE_PATH && env.ARCA_PRIVATE_KEY_PATH),
})

async function getSettings() {
  return prisma.arcaSettings.upsert({
    where: { id: 'default' },
    create: { id: 'default' },
    update: {},
  })
}

adminArcaRouter.get('/settings', async (_req, res) => {
  const settings = await getSettings()
  res.json({ data: settingsResponse(settings) })
})

const settingsSchema = z.object({
  enabled: z.boolean(),
  environment: z.literal('HOMOLOGATION'),
  pointOfSale: z.number().int().min(1).max(99_998).nullable(),
})

adminArcaRouter.put('/settings', async (req, res) => {
  const input = settingsSchema.parse(req.body)
  const credentialsConfigured = Boolean(env.ARCA_CUIT && env.ARCA_CERTIFICATE_PATH && env.ARCA_PRIVATE_KEY_PATH)

  if (input.enabled && (!credentialsConfigured || input.pointOfSale === null)) {
    res.status(409).json({
      error: {
        code: 'ARCA_CONFIGURATION_INCOMPLETE',
        message: 'Para habilitar ARCA necesitás configurar CUIT, certificado, clave privada y punto de venta.',
      },
    })
    return
  }

  const settings = await prisma.arcaSettings.upsert({
    where: { id: 'default' },
    create: { id: 'default', ...input },
    update: input,
  })
  res.json({ data: settingsResponse(settings), message: 'Configuración de ARCA guardada.' })
})

const testLimiter = rateLimit({ windowMs: 60 * 1000, limit: 3, standardHeaders: 'draft-8', legacyHeaders: false })

adminArcaRouter.post('/settings/test', testLimiter, async (_req, res) => {
  const settings = await getSettings()
  if (!settings.pointOfSale) {
    res.status(409).json({
      error: { code: 'ARCA_POINT_OF_SALE_MISSING', message: 'Configurá el punto de venta antes de probar la conexión.' },
    })
    return
  }

  try {
    const ticket = await getArcaAccessTicket('HOMOLOGATION')
    res.json({
      data: { connected: true, expiresAt: ticket.expiresAt.toISOString() },
      message: 'Conexión con ARCA homologación verificada correctamente.',
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'No se pudo verificar la conexión con ARCA.'
    res.status(502).json({ error: { code: 'ARCA_CONNECTION_FAILED', message } })
  }
})


const diagnosticsLimiter = rateLimit({ windowMs: 60 * 1000, limit: 2, standardHeaders: 'draft-8', legacyHeaders: false })

// Consulta únicamente información de homologación. Nunca autoriza comprobantes.
adminArcaRouter.get('/diagnostics', diagnosticsLimiter, async (_req, res) => {
  const settings = await getSettings()
  if (!settings.pointOfSale) {
    res.status(409).json({
      error: { code: 'ARCA_POINT_OF_SALE_MISSING', message: 'Guardá el punto de venta antes de consultar los datos de ARCA.' },
    })
    return
  }
  if (!env.ARCA_CUIT || !env.ARCA_CERTIFICATE_PATH || !env.ARCA_PRIVATE_KEY_PATH) {
    res.status(409).json({
      error: { code: 'ARCA_CREDENTIALS_MISSING', message: 'Falta configurar el CUIT, el certificado y la clave privada en la API.' },
    })
    return
  }

  try {
    const [pointsOfSale, voucherTypes, ivaReceiverConditions] = await Promise.all([
      getArcaPointsOfSale('HOMOLOGATION'),
      getArcaVoucherTypes('HOMOLOGATION'),
      getArcaIvaReceiverConditions('HOMOLOGATION', 'C'),
    ])
    const selectedPoint = pointsOfSale.find((point) => point.number === settings.pointOfSale)
    const lastAuthorized = selectedPoint && !selectedPoint.blocked
      ? await getArcaLastAuthorizedVoucher('HOMOLOGATION', settings.pointOfSale, 11)
      : null

    res.json({
      data: {
        pointOfSale: settings.pointOfSale,
        pointsOfSale,
        selectedPointFound: Boolean(selectedPoint),
        lastAuthorized,
        voucherTypes,
        ivaReceiverConditions,
        queriedAt: new Date().toISOString(),
      },
      message: 'Consultas de solo lectura completadas en ARCA homologación.',
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'No se pudieron consultar los datos de ARCA.'
    res.status(502).json({ error: { code: 'ARCA_DIAGNOSTICS_FAILED', message } })
  }
})


const issueInvoiceLimiter = rateLimit({ windowMs: 60 * 1000, limit: 1, standardHeaders: 'draft-8', legacyHeaders: false })

const invoiceCInputSchema = z.object({
  requestKey: z.string().uuid(),
  paymentConfirmed: z.literal(true),
  receiverDocumentType: z.number().int().min(1).max(99),
  receiverDocumentNumber: z.string().trim().regex(/^\d{1,20}$/),
  receiverVatConditionId: z.number().int().min(1).max(999),
  receiverName: z.string().trim().min(2).max(200).optional(),
  receiverAddress: z.string().trim().max(300).optional(),
})

adminArcaRouter.post('/orders/:orderId/invoice-c', issueInvoiceLimiter, async (req, res) => {
  const input = invoiceCInputSchema.parse(req.body)
  const settings = await getSettings()
  if (!settings.enabled || settings.environment !== 'HOMOLOGATION' || !settings.pointOfSale) {
    res.status(409).json({
      error: { code: 'ARCA_ISSUANCE_NOT_ENABLED', message: 'La emisión de prueba requiere habilitar ARCA homologación y configurar un punto de venta.' },
    })
    return
  }
  if (!env.ARCA_CUIT || !env.ARCA_CERTIFICATE_PATH || !env.ARCA_PRIVATE_KEY_PATH) {
    res.status(409).json({
      error: { code: 'ARCA_CREDENTIALS_MISSING', message: 'Falta configurar el CUIT, certificado y clave privada en la API.' },
    })
    return
  }

  const pointOfSale = settings.pointOfSale
  const orderId = Array.isArray(req.params.orderId) ? req.params.orderId[0] : req.params.orderId
  const lockKey = `arca-wsfe-${pointOfSale}-11`
  const reserved = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`

    const sameRequest = await tx.fiscalDocument.findUnique({ where: { requestKey: input.requestKey } })
    if (sameRequest) return { document: sameRequest, alreadyExists: true as const }

    const blockedDocument = await tx.fiscalDocument.findFirst({
      where: {
        pointOfSale,
        voucherType: 11,
        status: { in: [FiscalDocumentStatus.PENDING, FiscalDocumentStatus.ISSUING, FiscalDocumentStatus.UNKNOWN] },
      },
      orderBy: { createdAt: 'desc' },
    })
    if (blockedDocument) {
      throw new Error('ARCA_ISSUANCE_RECONCILIATION_REQUIRED')
    }

    const order = await tx.order.findUnique({
      where: { id: orderId },
      include: { items: true },
    })
    if (!order) throw new Error('ORDER_NOT_FOUND')
    if (!['CONFIRMED', 'PREPARING', 'SHIPPED', 'DELIVERED'].includes(order.status)) {
      throw new Error('ORDER_NOT_READY_FOR_INVOICE')
    }

    const existingInvoice = await tx.fiscalDocument.findFirst({
      where: {
        orderId: order.id,
        type: FiscalDocumentType.INVOICE_C,
        status: { in: [FiscalDocumentStatus.PENDING, FiscalDocumentStatus.ISSUING, FiscalDocumentStatus.UNKNOWN, FiscalDocumentStatus.AUTHORIZED] },
      },
    })
    if (existingInvoice) throw new Error('ORDER_ALREADY_HAS_INVOICE')

    const totalAmountArs = order.totalArs ?? (order.subtotalArs + (order.shippingCostArs ?? 0))
    if (!Number.isSafeInteger(totalAmountArs) || totalAmountArs <= 0) throw new Error('INVALID_ORDER_TOTAL')

    const lastAuthorized = await getArcaLastAuthorizedVoucher(settings.environment, pointOfSale, 11)
    const voucherNumber = lastAuthorized.lastVoucherNumber + 1
    if (!Number.isSafeInteger(voucherNumber) || voucherNumber < 1 || voucherNumber > 99_999_999) {
      throw new Error('INVALID_ARCA_VOUCHER_NUMBER')
    }

    const issueDate = new Date()
    const receiverName = input.receiverName || order.customerName
    const receiverAddress = input.receiverAddress || [order.addressLine, order.city, order.province, order.postalCode].filter(Boolean).join(', ')
    const request = {
      pointOfSale,
      voucherNumber,
      issueDate,
      receiverDocumentType: input.receiverDocumentType,
      receiverDocumentNumber: input.receiverDocumentNumber,
      receiverVatConditionId: input.receiverVatConditionId,
      totalAmountArs,
    }
    const itemsSnapshot = order.items.map((item) => ({
      productName: item.productName,
      productSku: item.productSku,
      unitPriceArs: item.unitPriceArs,
      quantity: item.quantity,
      lineTotalArs: item.lineTotalArs,
    }))

    const document = await tx.fiscalDocument.create({
      data: {
        orderId: order.id,
        type: FiscalDocumentType.INVOICE_C,
        status: FiscalDocumentStatus.ISSUING,
        requestKey: input.requestKey,
        pointOfSale: settings.pointOfSale,
        voucherType: 11,
        voucherNumber,
        issueDate,
        receiverDocumentType: input.receiverDocumentType,
        receiverDocumentNumber: input.receiverDocumentNumber,
        receiverVatConditionId: input.receiverVatConditionId,
        receiverName,
        receiverAddress,
        currencyCode: 'PES',
        currencyRate: new Prisma.Decimal(1),
        concept: 1,
        netAmountArs: 0,
        exemptAmountArs: 0,
        nonTaxedAmountArs: totalAmountArs,
        vatAmountArs: 0,
        tributeAmountArs: 0,
        totalAmountArs,
        items: itemsSnapshot as Prisma.InputJsonValue,
        requestPayload: { ...buildArcaInvoiceCRequestPayload(request), paymentConfirmedByAdmin: true } as Prisma.InputJsonValue,
        attempts: 1,
      },
    })
    return { document, alreadyExists: false as const }
  }, { maxWait: 10_000, timeout: 60_000 }).catch((error: unknown) => {
    const code = error instanceof Error ? error.message : ''
    const conflicts: Record<string, { status: number; message: string }> = {
      ORDER_NOT_FOUND: { status: 404, message: 'Pedido no encontrado.' },
      ORDER_NOT_READY_FOR_INVOICE: { status: 409, message: 'El pedido debe estar confirmado y no cancelado antes de facturarlo.' },
      ORDER_ALREADY_HAS_INVOICE: { status: 409, message: 'Este pedido ya tiene una factura autorizada o pendiente de conciliación.' },
      ARCA_ISSUANCE_RECONCILIATION_REQUIRED: { status: 409, message: 'Hay una emisión anterior pendiente de conciliación en este punto de venta. No se emitirán más comprobantes hasta resolverla.' },
      INVALID_ORDER_TOTAL: { status: 409, message: 'El pedido no tiene un total válido para facturar.' },
      INVALID_ARCA_VOUCHER_NUMBER: { status: 409, message: 'ARCA devolvió un número de comprobante fuera del rango permitido.' },
    }
    const conflict = conflicts[code]
    if (!conflict) throw error
    res.status(conflict.status).json({ error: { code, message: conflict.message } })
    return null
  })

  if (!reserved) return

  if (reserved.alreadyExists) {
    res.status(200).json({
      data: reserved.document,
      message: 'Esta clave de solicitud ya fue procesada. No se volvió a contactar a ARCA.',
    })
    return
  }

  try {
    const result = await requestArcaInvoiceC(settings.environment, {
      pointOfSale: reserved.document.pointOfSale!,
      voucherNumber: reserved.document.voucherNumber!,
      issueDate: reserved.document.issueDate!,
      receiverDocumentType: reserved.document.receiverDocumentType!,
      receiverDocumentNumber: reserved.document.receiverDocumentNumber!,
      receiverVatConditionId: reserved.document.receiverVatConditionId!,
      totalAmountArs: reserved.document.totalAmountArs,
    })
    const updated = await prisma.fiscalDocument.update({
      where: { id: reserved.document.id },
      data: {
        status: result.outcome,
        cae: result.cae,
        caeExpiresAt: result.caeExpiresAt,
        authorizedAt: result.outcome === 'AUTHORIZED' ? new Date() : null,
        responsePayload: result.responsePayload as Prisma.InputJsonValue,
        lastErrorCode: result.outcome === 'REJECTED' ? 'ARCA_REJECTED' : result.outcome === 'UNKNOWN' ? 'ARCA_RESULT_UNKNOWN' : null,
        lastErrorMessage: result.outcome === 'AUTHORIZED' ? null : result.message,
      },
    })
    res.status(result.outcome === 'AUTHORIZED' ? 201 : result.outcome === 'REJECTED' ? 200 : 202).json({
      data: updated,
      message: result.message,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'No se pudo confirmar el resultado de la emisión.'
    const updated = await prisma.fiscalDocument.update({
      where: { id: reserved.document.id },
      data: {
        status: FiscalDocumentStatus.UNKNOWN,
        lastErrorCode: 'ARCA_RESULT_UNKNOWN',
        lastErrorMessage: message.slice(0, 1000),
      },
    })
    res.status(202).json({
      data: updated,
      message: 'No se pudo confirmar la respuesta de ARCA. El comprobante quedó bloqueado para evitar una emisión duplicada; requiere conciliación antes de reintentar.',
    })
  }
})
