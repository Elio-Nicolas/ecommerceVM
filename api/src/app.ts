import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import { env } from './config/env'
import { errorHandler } from './middleware/error-handler'
import { categoriesRouter } from './routes/categories.routes'
import { healthRouter } from './routes/health.routes'
import { productsRouter } from './routes/products.routes'
import { authRouter } from './routes/auth.routes'
import { adminProductsRouter } from './routes/admin-products.routes'
import { adminCategoriesRouter } from './routes/admin-categories.routes'
import { adminStorageRouter } from './routes/admin-storage.routes'
import { ordersRouter } from './routes/orders.routes'
import { adminOrdersRouter } from './routes/admin-orders.routes'
import { adminShippingOriginsRouter } from './routes/admin-shipping-origins.routes'
import { adminShippingSettingsRouter } from './routes/admin-shipping-settings.routes'
import { shippingRouter } from './routes/shipping.routes'
import { adminArcaRouter } from './routes/admin-arca.routes'
import { paymentsRouter } from './routes/payments.routes'

export const app = express()
app.disable('x-powered-by')
app.use(helmet())

// Keep the production storefront available even when Render still has the
// local-development CORS_ORIGIN value configured. Additional origins remain
// configurable through CORS_ORIGIN (comma-separated).
const allowedOrigins = [...new Set([
  ...env.CORS_ORIGIN,
  'https://ecommerce-vm.vercel.app',
])]
app.use(cors({ origin: allowedOrigins }))

app.use(express.json({ limit: '1mb' }))
app.get('/api/v1', (_req, res) => { res.json({ service: 'ecommercevm-api', version: '1.0.0' }) })
app.use('/api/v1/health', healthRouter)
app.use('/api/v1/auth', authRouter)
app.use('/api/v1/admin/products', adminProductsRouter)
app.use('/api/v1/admin/categories', adminCategoriesRouter)
app.use('/api/v1/admin/storage', adminStorageRouter)
app.use('/api/v1/admin/orders', adminOrdersRouter)
app.use('/api/v1/admin/arca', adminArcaRouter)
app.use('/api/v1/payments', paymentsRouter)
app.use('/api/v1/admin/shipping-origins', adminShippingOriginsRouter)
app.use('/api/v1/admin/shipping-settings', adminShippingSettingsRouter)
app.use('/api/v1/categories', categoriesRouter)
app.use('/api/v1/products', productsRouter)
app.use('/api/v1/shipping', shippingRouter)
app.use('/api/v1/orders', ordersRouter)
app.use((_req, res) => { res.status(404).json({ error: { code: 'ROUTE_NOT_FOUND', message: 'Recurso no encontrado' } }) })
app.use(errorHandler)
