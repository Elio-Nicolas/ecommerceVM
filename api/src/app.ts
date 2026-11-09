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
export const app = express()
app.disable('x-powered-by')
app.use(helmet())
app.use(cors({ origin: env.CORS_ORIGIN.split(',').map((origin) => origin.trim()) }))
app.use(express.json({ limit: '1mb' }))
app.get('/api/v1', (_req, res) => { res.json({ service: 'ecommercevm-api', version: '1.0.0' }) })
app.use('/api/v1/health', healthRouter)
app.use('/api/v1/auth', authRouter)
app.use('/api/v1/admin/products', adminProductsRouter)
app.use('/api/v1/admin/categories', adminCategoriesRouter)
app.use('/api/v1/admin/storage', adminStorageRouter)
app.use('/api/v1/categories', categoriesRouter)
app.use('/api/v1/products', productsRouter)
app.use((_req, res) => { res.status(404).json({ error: { code: 'ROUTE_NOT_FOUND', message: 'Recurso no encontrado' } }) })
app.use(errorHandler)
