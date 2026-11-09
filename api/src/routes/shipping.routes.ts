import { Router } from 'express'
import { Prisma } from '@prisma/client'
import { rateLimit } from 'express-rate-limit'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import { quoteHomeDelivery, ShippingProviderError } from '../services/enviopack'
import { shippingCartFingerprint } from '../services/shipping-fingerprint'

export const shippingRouter = Router()

const quoteLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: { code: 'SHIPPING_QUOTE_RATE_LIMIT', message: 'Se alcanzó el límite de cotizaciones. Intentá nuevamente más tarde.' } },
})

const quoteSchema = z.object({
  provinceCode: z.string().length(1).regex(/^[A-Z]$/),
  postalCode: z.string().regex(/^\d{4}$/),
  items: z.array(z.object({
    productId: z.string().uuid(),
    quantity: z.number().int().min(1).max(20),
  })).min(1).max(20).superRefine((items, ctx) => {
    if (new Set(items.map((item) => item.productId)).size !== items.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'No repitas productos en la cotización.' })
    }
    if (items.reduce((sum, item) => sum + item.quantity, 0) > 20) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'El envío admite hasta 20 unidades por cotización.' })
    }
  }),
})

shippingRouter.post('/quotes', quoteLimiter, async (req, res) => {
  const input = quoteSchema.parse(req.body)
  const origin = await prisma.shippingOrigin.findFirst({ where: { isActive: true, isDefault: true } })
  if (!origin) {
    res.status(503).json({ error: { code: 'SHIPPING_ORIGIN_NOT_CONFIGURED', message: 'La tienda todavía no tiene configurado un depósito de despacho predeterminado.' } })
    return
  }

  const products = await prisma.product.findMany({
    where: { id: { in: input.items.map((item) => item.productId) }, status: 'ACTIVE' },
    select: {
      id: true, priceArs: true, stock: true, weightGrams: true,
      packageLengthCm: true, packageWidthCm: true, packageHeightCm: true,
    },
  })
  if (products.length !== input.items.length) {
    res.status(409).json({ error: { code: 'SHIPPING_CART_CHANGED', message: 'Uno o más productos ya no están disponibles. Actualizá el carrito.' } })
    return
  }

  const byId = new Map(products.map((product) => [product.id, product]))
  let subtotalArs = 0
  let weightGrams = 0
  const packages: Array<{ lengthCm: number; widthCm: number; heightCm: number }> = []
  for (const item of input.items) {
    const product = byId.get(item.productId)!
    if (product.stock < item.quantity) {
      res.status(409).json({ error: { code: 'SHIPPING_STOCK_CHANGED', message: 'No hay stock suficiente para uno o más productos.' } })
      return
    }
    if (!product.weightGrams || !product.packageLengthCm || !product.packageWidthCm || !product.packageHeightCm) {
      res.status(422).json({ error: { code: 'PRODUCT_PACKAGE_INCOMPLETE', message: 'Hay productos sin peso o dimensiones de embalaje. La tienda debe completar esos datos antes de cotizar el envío.' } })
      return
    }
    subtotalArs += product.priceArs * item.quantity
    weightGrams += product.weightGrams * item.quantity
    for (let count = 0; count < item.quantity; count += 1) {
      packages.push({
        lengthCm: product.packageLengthCm,
        widthCm: product.packageWidthCm,
        heightCm: product.packageHeightCm,
      })
    }
  }

  if (!Number.isSafeInteger(subtotalArs) || subtotalArs < 1 || subtotalArs > 2_000_000_000 || weightGrams < 1) {
    res.status(422).json({ error: { code: 'SHIPPING_PACKAGE_INVALID', message: 'Los datos de peso o importe del carrito no son válidos.' } })
    return
  }

  try {
    const options = await quoteHomeDelivery({
      provinceCode: input.provinceCode,
      postalCode: input.postalCode,
      weightGrams,
      packages,
      originAddressId: origin.enviopackAddressId,
    })
    if (options.length === 0) {
      res.status(422).json({ error: { code: 'SHIPPING_UNAVAILABLE', message: 'Envíopack no encontró servicios disponibles para ese código postal.' } })
      return
    }

    const expiresAt = new Date(Date.now() + 10 * 60 * 1000)
    const quote = await prisma.shippingQuote.create({
      data: {
        provinceCode: input.provinceCode,
        postalCode: input.postalCode,
        cartFingerprint: shippingCartFingerprint(input.items, products),
        subtotalArs,
        options: options as unknown as Prisma.InputJsonArray,
        expiresAt,
      },
    })
    res.status(201).json({
      data: {
        id: quote.id,
        subtotalArs,
        options: options.map(({ sellerOptions: _sellerOptions, sellerCostStatus: _sellerCostStatus, ...buyerOption }) => buyerOption),
        expiresAt: quote.expiresAt,
      },
    })
  } catch (error) {
    if (error instanceof ShippingProviderError) {
      const notConfigured = error.message.includes('todavía no está configurada')
      res.status(notConfigured ? 503 : 502).json({
        error: {
          code: notConfigured ? 'SHIPPING_PROVIDER_NOT_CONFIGURED' : 'SHIPPING_PROVIDER_ERROR',
          message: error.message,
        },
      })
      return
    }
    throw error
  }
})
