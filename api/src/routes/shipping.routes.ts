import { Router } from 'express'
import { rateLimit } from 'express-rate-limit'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import { getShippingSettingsPublic, getStoredOcaCredentials } from '../services/shipping-settings'
import { quoteOca, OcaError } from '../services/oca'
import { shippingCartFingerprint } from '../services/shipping-fingerprint'

export const shippingRouter = Router()
shippingRouter.get('/methods', async (_req, res) => res.json({ data: await getShippingSettingsPublic() }))

const quoteLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: 'draft-8', legacyHeaders: false,
  message: { error: { code: 'SHIPPING_QUOTE_RATE_LIMIT', message: 'Se alcanzó el límite de cotizaciones. Intentá nuevamente más tarde.' } },
})
const quoteSchema = z.object({
  provinceCode: z.string().length(1).regex(/^[A-Z]$/),
  postalCode: z.string().regex(/^\d{4}$/),
  items: z.array(z.object({ productId: z.string().uuid(), quantity: z.number().int().min(1).max(99) })).min(1).max(30),
}).superRefine((input, ctx) => {
  const ids = input.items.map((item) => item.productId)
  if (new Set(ids).size !== ids.length) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'No repitas productos en el pedido.' })
})

shippingRouter.post('/quotes', quoteLimiter, async (req, res) => {
  const input = quoteSchema.parse(req.body)
  const [credentials, origin, products] = await Promise.all([
    getStoredOcaCredentials(),
    prisma.shippingOrigin.findFirst({ where: { isActive: true, isDefault: true } }),
    prisma.product.findMany({
      where: { id: { in: input.items.map((item) => item.productId) }, status: 'ACTIVE' },
      select: { id: true, priceArs: true, stock: true, weightGrams: true, packageLengthCm: true, packageWidthCm: true, packageHeightCm: true },
    }),
  ])
  if (!credentials) return res.status(503).json({ error: { code: 'OCA_NOT_CONFIGURED', message: 'OCA todavía no está configurado. Retiro y entrega local siguen disponibles.' } })
  if (!origin) return res.status(503).json({ error: { code: 'SHIPPING_ORIGIN_NOT_CONFIGURED', message: 'Configurá un depósito de despacho predeterminado con su código postal.' } })
  if (products.length !== input.items.length) return res.status(422).json({ error: { code: 'SHIPPING_PRODUCTS_UNAVAILABLE', message: 'Uno o más productos ya no están disponibles.' } })

  let weightGrams = 0, volumeCm3 = 0, subtotalArs = 0
  for (const item of input.items) {
    const product = products.find((candidate) => candidate.id === item.productId)!
    if (!product.weightGrams || !product.packageLengthCm || !product.packageWidthCm || !product.packageHeightCm) {
      return res.status(422).json({ error: { code: 'SHIPPING_PACKAGE_DATA_MISSING', message: 'Completá peso y dimensiones de los productos para cotizar con OCA.' } })
    }
    if (product.stock < item.quantity) return res.status(409).json({ error: { code: 'SHIPPING_STOCK_CHANGED', message: 'No hay stock suficiente para uno o más productos.' } })
    weightGrams += product.weightGrams * item.quantity
    volumeCm3 += product.packageLengthCm * product.packageWidthCm * product.packageHeightCm * item.quantity
    subtotalArs += product.priceArs * item.quantity
  }
  try {
    const option = await quoteOca({ postalCode: input.postalCode, originPostalCode: origin.postalCode, weightGrams, volumeCm3, packages: 1, declaredValueArs: subtotalArs })
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000)
    const quote = await prisma.shippingQuote.create({
      data: { provinceCode: input.provinceCode, postalCode: input.postalCode, cartFingerprint: shippingCartFingerprint(input.items, products), subtotalArs, options: [option], expiresAt },
    })
    return res.json({ data: { id: quote.id, subtotalArs, options: [option], expiresAt } })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'No se pudo cotizar el envío con OCA.'
    return res.status(error instanceof OcaError ? error.statusCode : 502).json({
      error: { code: error instanceof OcaError && error.statusCode === 503 ? 'OCA_NOT_CONFIGURED' : 'OCA_QUOTE_ERROR', message },
    })
  }
})
