import { Router } from 'express'
import { ProductStatus } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import { requireAdmin } from '../middleware/require-admin'

export const adminProductsRouter = Router()
adminProductsRouter.use(requireAdmin)

const productSchema = z.object({
  sku: z.string().trim().min(2).max(60),
  slug: z.string().trim().min(2).max(120).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  name: z.string().trim().min(2).max(160),
  description: z.string().trim().min(5).max(5000),
  priceArs: z.number().int().min(1).max(2000000000),
  compareAtArs: z.number().int().min(1).max(2000000000).nullable().optional(),
  stock: z.number().int().min(0).max(1000000),
  weightGrams: z.number().int().min(1).max(1000000).nullable().optional(),
  packageLengthCm: z.number().int().min(1).max(300).nullable().optional(),
  packageWidthCm: z.number().int().min(1).max(300).nullable().optional(),
  packageHeightCm: z.number().int().min(1).max(300).nullable().optional(),
  status: z.nativeEnum(ProductStatus),
  featured: z.boolean().default(false),
  badge: z.string().trim().max(50).nullable().optional(),
  imageUrl: z.string().url().nullable().optional(),
  specs: z.array(z.string().trim().min(1).max(160)).max(20).default([]),
  categoryId: z.string().uuid(),
})

adminProductsRouter.get('/', async (req, res) => {
  const page = z.coerce.number().int().min(1).default(1).parse(req.query.page)
  const limit = z.coerce.number().int().min(1).max(100).default(30).parse(req.query.limit)
  const [data, total] = await prisma.$transaction([
    prisma.product.findMany({ include: { category: true }, orderBy: { updatedAt: 'desc' }, skip: (page - 1) * limit, take: limit }),
    prisma.product.count(),
  ])
  res.json({ data, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } })
})

adminProductsRouter.post('/', async (req, res) => {
  const input = productSchema.parse(req.body)
  if (!(await prisma.category.findUnique({ where: { id: input.categoryId } }))) {
    res.status(400).json({ error: { code: 'CATEGORY_NOT_FOUND', message: 'La categoría no existe' } })
    return
  }
  const product = await prisma.product.create({ data: input, include: { category: true } })
  res.status(201).json({ data: product })
})

adminProductsRouter.put('/:id', async (req, res) => {
  const input = productSchema.partial().parse(req.body)
  const existing = await prisma.product.findUnique({ where: { id: req.params.id } })
  if (!existing) {
    res.status(404).json({ error: { code: 'PRODUCT_NOT_FOUND', message: 'Producto no encontrado' } })
    return
  }
  if (input.categoryId && !(await prisma.category.findUnique({ where: { id: input.categoryId } }))) {
    res.status(400).json({ error: { code: 'CATEGORY_NOT_FOUND', message: 'La categoría no existe' } })
    return
  }
  const product = await prisma.product.update({ where: { id: req.params.id }, data: input, include: { category: true } })
  res.json({ data: product })
})

adminProductsRouter.delete('/:id', async (req, res) => {
  const existing = await prisma.product.findUnique({ where: { id: req.params.id } })
  if (!existing) {
    res.status(404).json({ error: { code: 'PRODUCT_NOT_FOUND', message: 'Producto no encontrado' } })
    return
  }
  const product = await prisma.product.update({ where: { id: req.params.id }, data: { status: 'ARCHIVED' }, include: { category: true } })
  res.json({ data: product, message: 'Producto archivado; no se eliminó físicamente.' })
})
