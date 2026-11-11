import { createHash, randomBytes } from 'node:crypto'
import { Router } from 'express'
import { rateLimit } from 'express-rate-limit'
import { Prisma } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import { getShippingSettings } from '../services/shipping-settings'
import { shippingCartFingerprint } from '../services/shipping-fingerprint'

export const ordersRouter = Router()

const createOrderLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: { code: 'ORDER_RATE_LIMIT', message: 'Se alcanzó el límite de pedidos. Intentá nuevamente más tarde.' } },
})

const createOrderSchema = z.object({
  checkoutRequestKey: z.string().uuid().optional(),
  customerName: z.string().trim().min(2).max(120),
  customerEmail: z.union([z.string().trim().email().max(160), z.literal('')]).optional().transform((value) => value || null),
  customerPhone: z.string().trim().min(8).max(30).regex(/^[+0-9\s().-]+$/, 'Ingresá un teléfono válido.').refine((value) => value.replace(/\D/g, '').length >= 8, 'Ingresá al menos 8 dígitos.'),
  addressLine: z.string().trim().min(4).max(180),
  city: z.string().trim().min(2).max(100),
  province: z.string().trim().min(2).max(100),
  postalCode: z.string().trim().regex(/^\d{4}$/, 'Ingresá un código postal de cuatro dígitos.'),
  provinceCode: z.string().length(1).regex(/^[A-Z]$/).optional(),
  deliveryMethod: z.enum(['ENVIOPACK', 'LOCAL_DELIVERY', 'PICKUP']).default('ENVIOPACK'),
  shippingQuoteId: z.string().uuid().optional(),
  shippingOptionKey: z.string().trim().min(1).max(40).optional(),
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

function isLegacyShippingMethod(method: string): boolean {
  return method === 'ENVIOPACK'
}

class OrderConflictError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'OrderConflictError'
  }
}

const receiptRefreshLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
})

ordersRouter.get('/:id/receipt', receiptRefreshLimiter, async (req, res) => {
  const id = z.string().uuid().safeParse(req.params.id)
  if (!id.success) {
    res.status(404).json({ error: { code: 'ORDER_NOT_FOUND', message: 'Pedido no encontrado.' } })
    return
  }
  const order = await prisma.order.findUnique({
    where: { id: id.data },
    select: { shippingCostArs: true, totalArs: true },
  })
  if (!order) {
    res.status(404).json({ error: { code: 'ORDER_NOT_FOUND', message: 'Pedido no encontrado.' } })
    return
  }
  res.setHeader('Cache-Control', 'no-store')
  res.json({ data: order })
})

ordersRouter.post('/', createOrderLimiter, async (req, res) => {
  const input = createOrderSchema.parse(req.body)
  const checkoutFingerprint = input.checkoutRequestKey
    ? createHash('sha256').update(JSON.stringify({
        ...input,
        items: [...input.items].sort((a, b) => a.productId.localeCompare(b.productId)),
      })).digest('hex')
    : null

  if (input.checkoutRequestKey) {
    const previousOrder = await prisma.order.findUnique({
      where: { checkoutRequestKey: input.checkoutRequestKey },
      include: { items: true },
    })
    if (previousOrder) {
      if (previousOrder.checkoutFingerprint !== checkoutFingerprint) {
        res.status(409).json({ error: { code: 'ORDER_IDEMPOTENCY_CONFLICT', message: 'Esta solicitud ya registró un pedido con datos diferentes. Actualizá el checkout antes de volver a intentar.' } })
        return
      }
      res.setHeader('Cache-Control', 'no-store')
      res.status(200).json({
        data: {
          id: previousOrder.id,
          code: previousOrder.code,
          status: previousOrder.status,
          subtotalArs: previousOrder.subtotalArs,
          shippingCostArs: previousOrder.shippingCostArs,
          totalArs: previousOrder.totalArs,
          createdAt: previousOrder.createdAt,
          items: previousOrder.items,
        },
        deliveryMethod: previousOrder.deliveryMethod,
        message: 'El pedido ya estaba registrado. No se creó un duplicado.',
      })
      return
    }
  }

  if (input.deliveryMethod === 'ENVIOPACK') {
    res.status(503).json({
      error: {
        code: 'SHIPPING_PROVIDER_MIGRATION_PENDING',
        message: 'Los envíos nacionales están en proceso de migración a OCA. Elegí retiro o entrega local si están disponibles.',
      },
    })
    return
  }

  try {
    if (input.deliveryMethod === 'ENVIOPACK' && (!input.customerEmail || input.customerEmail.length > 100)) {
      throw new OrderConflictError('Para realizar un envío por Envíopack necesitamos un correo electrónico válido de hasta 100 caracteres.')
    }
    const deliverySettings = await getShippingSettings()
    const order = await prisma.$transaction(async (tx) => {
      const now = new Date()
      let selectedOption: Prisma.JsonObject | undefined
      let shippingCostArs: number | null = 0
      let shippingCarrier: string | null = null
      let shippingService: string | null = null
      let shippingEstimatedHours: number | null = null
      let shippingQuoteId: string | null = null
      let shippingInternalCostArs: number | null = null
      let deliveryInstructions: string | null = null

      if (input.deliveryMethod === 'PICKUP') {
        if (!deliverySettings.pickupEnabled) throw new OrderConflictError('El retiro por domicilio no está disponible.')
        shippingCarrier = 'Retiro por domicilio'
        shippingService = 'Retiro coordinado'
        deliveryInstructions = `${deliverySettings.pickupAddress}. ${deliverySettings.pickupInstructions}`
      } else if (input.deliveryMethod === 'LOCAL_DELIVERY') {
        if (!deliverySettings.localDeliveryEnabled || !deliverySettings.localDeliveryPostalCodes.includes(input.postalCode)) {
          throw new OrderConflictError('La entrega local no está disponible para ese código postal.')
        }
        shippingCostArs = deliverySettings.localDeliveryCoordinate ? null : deliverySettings.localDeliveryFeeArs
        shippingCarrier = 'Entrega local'
        shippingService = deliverySettings.localDeliveryCoordinate ? 'A coordinar' : 'Entrega local'
        shippingInternalCostArs = deliverySettings.localDeliveryInternalCostArs
        deliveryInstructions = deliverySettings.localDeliveryCoordinate ? 'El costo de entrega se coordinará luego de confirmar el pedido.' : null
      } else {
        if (!input.shippingQuoteId || !input.shippingOptionKey || !input.provinceCode) {
          throw new OrderConflictError('Seleccioná una cotización vigente de Envíopack.')
        }
        const quote = await tx.shippingQuote.findFirst({
          where: {
            id: input.shippingQuoteId,
            provinceCode: input.provinceCode,
            postalCode: input.postalCode,
            expiresAt: { gt: now },
            usedAt: null,
          },
        })
        if (!quote) throw new OrderConflictError('La cotización de envío venció o ya no corresponde al carrito. Volvé a cotizar.')
        const quoteOptions = Array.isArray(quote.options) ? quote.options : []
        selectedOption = quoteOptions.find((option) =>
          typeof option === 'object' && option !== null && !Array.isArray(option) && option.key === input.shippingOptionKey,
        ) as Prisma.JsonObject | undefined
        if (!selectedOption) throw new OrderConflictError('La opción de envío seleccionada ya no está disponible. Volvé a cotizar.')
        shippingCostArs = Number(selectedOption.priceArs)
        shippingCarrier = typeof selectedOption.carrierName === 'string' ? selectedOption.carrierName : 'Envíopack'
        shippingService = typeof selectedOption.serviceLabel === 'string' ? selectedOption.serviceLabel : 'Envío estándar'
        shippingEstimatedHours = typeof selectedOption.estimatedHours === 'number' ? selectedOption.estimatedHours : null
        if (!Number.isSafeInteger(shippingCostArs) || shippingCostArs < 0) throw new OrderConflictError('El importe del envío no es válido. Volvé a cotizar.')
        const quoteUse = await tx.shippingQuote.updateMany({
          where: { id: quote.id, usedAt: null, expiresAt: { gt: now } },
          data: { usedAt: now },
        })
        if (quoteUse.count !== 1) throw new OrderConflictError('La cotización ya fue utilizada. Volvé a cotizar.')
        shippingQuoteId = quote.id
      }

      const products = await tx.product.findMany({
        where: { id: { in: input.items.map((item) => item.productId) }, status: 'ACTIVE' },
        select: { id: true, sku: true, name: true, priceArs: true, stock: true, weightGrams: true, packageLengthCm: true, packageWidthCm: true, packageHeightCm: true },
      })
      if (products.length !== input.items.length) {
        throw new OrderConflictError('Uno o más productos ya no están disponibles. Actualizá el carrito.')
      }
      if (input.deliveryMethod === 'ENVIOPACK') {
        const quote = input.shippingQuoteId ? await tx.shippingQuote.findUnique({ where: { id: input.shippingQuoteId } }) : null
        if (!quote || quote.cartFingerprint !== shippingCartFingerprint(input.items, products)) {
          throw new OrderConflictError('Los productos o sus paquetes cambiaron desde la cotización. Volvé a calcular el envío.')
        }
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
          weightGrams: product.weightGrams,
          packageLengthCm: product.packageLengthCm,
          packageWidthCm: product.packageWidthCm,
          packageHeightCm: product.packageHeightCm,
        }
      })
      if (!Number.isSafeInteger(subtotalArs) || subtotalArs < 1 || subtotalArs > 2_000_000_000) {
        throw new OrderConflictError('El importe del pedido no es válido.')
      }
      if (input.deliveryMethod === 'ENVIOPACK' && input.shippingQuoteId) {
        const quote = await tx.shippingQuote.findUnique({ where: { id: input.shippingQuoteId } })
        if (!quote || quote.subtotalArs !== subtotalArs) throw new OrderConflictError('El precio de los productos cambió desde la cotización. Volvé a calcular el envío.')
      }
      const totalArs = shippingCostArs === null ? null : subtotalArs + shippingCostArs
      if (totalArs !== null && (!Number.isSafeInteger(totalArs) || totalArs > 2_000_000_000)) {
        throw new OrderConflictError('El total del pedido supera el importe permitido.')
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
          checkoutRequestKey: input.checkoutRequestKey || null,
          checkoutFingerprint,
          customerName: input.customerName,
          customerEmail: input.customerEmail,
          customerPhone: input.customerPhone,
          addressLine: input.addressLine,
          city: input.city,
          province: input.province,
          provinceCode: input.provinceCode || null,
          postalCode: input.postalCode,
          customerNotes: input.customerNotes,
          subtotalArs,
          shippingCostArs,
          totalArs,
          shippingCarrier,
          shippingService,
          shippingEstimatedHours,
          shippingQuoteId,
          shippingOptionKey: input.shippingOptionKey || null,
          shippingCostOptions: selectedOption ? selectedOption as Prisma.InputJsonObject : Prisma.JsonNull,
          deliveryMethod: input.deliveryMethod,
          shippingInternalCostArs,
          deliveryInstructions,
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
      deliveryMethod: order.deliveryMethod,
      message: 'Pedido registrado. El pago todavía no está habilitado.',
    })
  } catch (error) {
    if (
      input.checkoutRequestKey &&
      error instanceof Prisma.PrismaClientKnownRequestError &&
      (error.code === 'P2002' || error.code === 'P2034')
    ) {
      const previousOrder = await prisma.order.findUnique({
        where: { checkoutRequestKey: input.checkoutRequestKey },
        include: { items: true },
      })
      if (previousOrder) {
        if (previousOrder.checkoutFingerprint !== checkoutFingerprint) {
          res.status(409).json({ error: { code: 'ORDER_IDEMPOTENCY_CONFLICT', message: 'Esta solicitud ya registró un pedido con datos diferentes. Actualizá el checkout antes de volver a intentar.' } })
          return
        }
        res.setHeader('Cache-Control', 'no-store')
        res.status(200).json({
          data: {
            id: previousOrder.id,
            code: previousOrder.code,
            status: previousOrder.status,
            subtotalArs: previousOrder.subtotalArs,
            shippingCostArs: previousOrder.shippingCostArs,
            totalArs: previousOrder.totalArs,
            createdAt: previousOrder.createdAt,
            items: previousOrder.items,
          },
          deliveryMethod: previousOrder.deliveryMethod,
          message: 'El pedido ya estaba registrado. No se creó un duplicado.',
        })
        return
      }
    }
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
