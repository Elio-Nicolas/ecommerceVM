import { Router } from 'express'
import { prisma } from '../lib/prisma'

export const categoriesRouter = Router()

categoriesRouter.get('/', async (_req, res) => {
  const categories = await prisma.category.findMany({
    orderBy: { name: 'asc' },
    select: {
      id: true,
      name: true,
      slug: true,
      description: true,
      _count: { select: { products: true } },
    },
  })

  res.json({ data: categories })
})
