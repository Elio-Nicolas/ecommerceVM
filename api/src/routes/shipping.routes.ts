import { Router } from 'express'
import { rateLimit } from 'express-rate-limit'
import { getShippingSettingsPublic } from '../services/shipping-settings'

export const shippingRouter = Router()

shippingRouter.get('/methods', async (_req, res) => {
  res.json({ data: await getShippingSettingsPublic() })
})

const quoteLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: { code: 'SHIPPING_QUOTE_RATE_LIMIT', message: 'Se alcanzó el límite de cotizaciones. Intentá nuevamente más tarde.' } },
})

shippingRouter.post('/quotes', quoteLimiter, (_req, res) => {
  res.status(503).json({
    error: {
      code: 'SHIPPING_PROVIDER_MIGRATION_PENDING',
      message: 'Los envíos nacionales están en proceso de migración a OCA. Por el momento podés elegir retiro o entrega local si están disponibles.',
    },
  })
})
