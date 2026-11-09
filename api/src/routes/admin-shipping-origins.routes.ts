import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import { requireAdmin } from '../middleware/require-admin'

export const adminShippingOriginsRouter = Router()
adminShippingOriginsRouter.use(requireAdmin)

const originSchema = z.object({
  name: z.string().trim().min(2).max(100),
  provinceCode: z.string().trim().length(1).regex(/^[A-Z]$/, 'Usá el código provincial ISO de Envíopack, sin el prefijo AR-.'),
  postalCode: z.string().trim().regex(/^\d{4}$/, 'Ingresá un código postal argentino de cuatro dígitos.'),
  enviopackAddressId: z.string().trim().max(100).nullable().optional(),
  isDefault: z.boolean().optional(),
  isActive: z.boolean().optional(),
})

adminShippingOriginsRouter.get('/', async (_req, res) => {
  const data = await prisma.shippingOrigin.findMany({ orderBy: [{ isDefault: 'desc' }, { name: 'asc' }] })
  res.json({ data })
})

adminShippingOriginsRouter.post('/', async (req, res) => {
  const input = originSchema.parse(req.body)
  const origin = await prisma.$transaction(async (tx) => {
    const hasActiveDefault = await tx.shippingOrigin.findFirst({ where: { isActive: true, isDefault: true }, select: { id: true } })
    const makeDefault = input.isDefault === true || (!hasActiveDefault && input.isActive !== false)
    if (makeDefault) await tx.shippingOrigin.updateMany({ data: { isDefault: false } })
    return tx.shippingOrigin.create({
      data: {
        name: input.name,
        provinceCode: input.provinceCode,
        postalCode: input.postalCode,
        enviopackAddressId: input.enviopackAddressId || null,
        isDefault: makeDefault,
        isActive: input.isActive ?? true,
      },
    })
  })
  res.status(201).json({ data: origin })
})

adminShippingOriginsRouter.put('/:id', async (req, res) => {
  const input = originSchema.partial().parse(req.body)
  const existing = await prisma.shippingOrigin.findUnique({ where: { id: req.params.id } })
  if (!existing) {
    res.status(404).json({ error: { code: 'SHIPPING_ORIGIN_NOT_FOUND', message: 'El depósito de despacho no existe.' } })
    return
  }
  const origin = await prisma.$transaction(async (tx) => {
    if (input.isDefault === true) await tx.shippingOrigin.updateMany({ data: { isDefault: false } })
    const updated = await tx.shippingOrigin.update({
      where: { id: req.params.id },
      data: {
        ...input,
        ...(input.enviopackAddressId !== undefined ? { enviopackAddressId: input.enviopackAddressId || null } : {}),
        ...(input.isActive === false ? { isDefault: false } : {}),
      },
    })
    if (!updated.isDefault && updated.isActive) {
      const otherDefault = await tx.shippingOrigin.findFirst({ where: { isActive: true, isDefault: true } })
      if (!otherDefault) return tx.shippingOrigin.update({ where: { id: updated.id }, data: { isDefault: true } })
    }
    return updated
  })
  res.json({ data: origin })
})

adminShippingOriginsRouter.delete('/:id', async (req, res) => {
  const existing = await prisma.shippingOrigin.findUnique({ where: { id: req.params.id } })
  if (!existing) {
    res.status(404).json({ error: { code: 'SHIPPING_ORIGIN_NOT_FOUND', message: 'El depósito de despacho no existe.' } })
    return
  }
  await prisma.shippingOrigin.delete({ where: { id: req.params.id } })
  if (existing.isDefault) {
    const next = await prisma.shippingOrigin.findFirst({ where: { isActive: true }, orderBy: { createdAt: 'asc' } })
    if (next) await prisma.shippingOrigin.update({ where: { id: next.id }, data: { isDefault: true } })
  }
  res.status(204).send()
})
