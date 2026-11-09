import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import { requireAdmin } from '../middleware/require-admin'

export const adminCategoriesRouter = Router()
adminCategoriesRouter.use(requireAdmin)

const categorySchema = z.object({
  name: z.string().trim().min(2).max(80),
  slug: z.string().trim().min(2).max(100).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  description: z.string().trim().max(500).nullable().optional(),
})

adminCategoriesRouter.get('/', async (_req, res) => {
  const data = await prisma.category.findMany({
    orderBy: { name: 'asc' },
    include: { _count: { select: { products: true } } },
  })
  res.json({ data })
})

adminCategoriesRouter.post('/', async (req, res) => {
  const input = categorySchema.parse(req.body)
  const data = await prisma.category.create({ data: input, include: { _count: { select: { products: true } } } })
  res.status(201).json({ data })
})

adminCategoriesRouter.put('/:id', async (req, res) => {
  const input = categorySchema.partial().parse(req.body)
  const existing = await prisma.category.findUnique({ where: { id: req.params.id } })
  if (!existing) {
    res.status(404).json({ error: { code: 'CATEGORY_NOT_FOUND', message: 'Categoría no encontrada' } })
    return
  }
  const data = await prisma.category.update({
    where: { id: req.params.id },
    data: input,
    include: { _count: { select: { products: true } } },
  })
  res.json({ data })
})

adminCategoriesRouter.delete('/:id', async (req, res) => {
  const existing = await prisma.category.findUnique({
    where: { id: req.params.id },
    include: { _count: { select: { products: true } } },
  })
  if (!existing) {
    res.status(404).json({ error: { code: 'CATEGORY_NOT_FOUND', message: 'Categoría no encontrada' } })
    return
  }
  if (existing._count.products > 0) {
    res.status(409).json({ error: { code: 'CATEGORY_IN_USE', message: 'No se puede eliminar: la categoría tiene productos asociados.' } })
    return
  }
  await prisma.category.delete({ where: { id: req.params.id } })
  res.json({ data: { id: req.params.id }, message: 'Categoría eliminada.' })
})
