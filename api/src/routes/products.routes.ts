import { Router } from 'express'
import { Prisma } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '../lib/prisma'

export const productsRouter = Router()

const listQuerySchema = z.object({
  q: z.string().trim().optional(),
  category: z.string().trim().optional(),
  sort: z.enum(['featured', 'price-asc', 'price-desc', 'name']).default('featured'),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(48).default(12),
})

productsRouter.get('/', async (req, res) => {
  const query = listQuerySchema.parse(req.query)
  const where: Prisma.ProductWhereInput = {
    status: 'ACTIVE',
    ...(query.category ? { category: { slug: query.category } } : {}),
    ...(query.q ? {
      OR: [
        { name: { contains: query.q, mode: 'insensitive' } },
        { description: { contains: query.q, mode: 'insensitive' } },
      ],
    } : {}),
  }

  const orderBy: Prisma.ProductOrderByWithRelationInput[] =
    query.sort === 'price-asc' ? [{ priceArs: 'asc' }] :
    query.sort === 'price-desc' ? [{ priceArs: 'desc' }] :
    query.sort === 'name' ? [{ name: 'asc' }] :
    [{ featured: 'desc' }, { createdAt: 'desc' }]

  const skip = (query.page - 1) * query.limit
  const [items, total] = await prisma.$transaction([
    prisma.product.findMany({
      where,
      orderBy,
      skip,
      take: query.limit,
      include: { category: true },
    }),
    prisma.product.count({ where }),
  ])

  res.json({
    data: items,
    pagination: {
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.ceil(total / query.limit),
    },
  })
})

productsRouter.get('/:slug', async (req, res) => {
  const product = await prisma.product.findFirst({
    where: { slug: req.params.slug, status: 'ACTIVE' },
    include: { category: true },
  })

  if (!product) {
    res.status(404).json({ error: { code: 'PRODUCT_NOT_FOUND', message: 'Producto no encontrado' } })
    return
  }

  res.json({ data: product })
})
