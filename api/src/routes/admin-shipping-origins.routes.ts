import { Router } from 'express'
import { Prisma } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import { requireAdmin } from '../middleware/require-admin'

export const adminShippingOriginsRouter = Router()
adminShippingOriginsRouter.use(requireAdmin)

const DEFAULT_LOCK = 'ecommercevm-shipping-origin-default'

const originSchema = z.object({
  name: z.string().trim().min(2).max(100),
  provinceCode: z.string().trim().length(1).regex(/^[A-Z]$/, 'Usá el código provincial ISO de Envíopack, sin el prefijo AR-.'),
  postalCode: z.string().trim().regex(/^\d{4}$/, 'Ingresá un código postal argentino de cuatro dígitos.'),
  enviopackAddressId: z.string().trim().max(100).nullable().optional(),
  isDefault: z.boolean().optional(),
  isActive: z.boolean().optional(),
})

async function lockDefaultOrigin(tx: Prisma.TransactionClient) {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${DEFAULT_LOCK}, 0))`
}

async function ensureActiveDefault(tx: Prisma.TransactionClient, preferredId?: string) {
  const current = await tx.shippingOrigin.findFirst({
    where: { isActive: true, isDefault: true },
    select: { id: true },
  })
  if (current) return

  const candidate = preferredId
    ? await tx.shippingOrigin.findFirst({ where: { id: preferredId, isActive: true }, select: { id: true } })
    : null
  const fallback = candidate || await tx.shippingOrigin.findFirst({
    where: { isActive: true },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: { id: true },
  })
  if (fallback) await tx.shippingOrigin.update({ where: { id: fallback.id }, data: { isDefault: true } })
}

adminShippingOriginsRouter.get('/', async (_req, res) => {
  const data = await prisma.shippingOrigin.findMany({ orderBy: [{ isDefault: 'desc' }, { name: 'asc' }] })
  res.json({ data })
})

adminShippingOriginsRouter.post('/', async (req, res) => {
  const input = originSchema.parse(req.body)
  const origin = await prisma.$transaction(async (tx) => {
    await lockDefaultOrigin(tx)
    const hasActiveDefault = await tx.shippingOrigin.findFirst({
      where: { isActive: true, isDefault: true },
      select: { id: true },
    })
    const makeDefault = input.isActive !== false && (input.isDefault === true || !hasActiveDefault)
    if (makeDefault) await tx.shippingOrigin.updateMany({ where: { isDefault: true }, data: { isDefault: false } })
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
  const origin = await prisma.$transaction(async (tx) => {
    await lockDefaultOrigin(tx)
    const existing = await tx.shippingOrigin.findUnique({ where: { id: req.params.id } })
    if (!existing) return null

    const active = input.isActive ?? existing.isActive
    const wantsDefault = active && (input.isDefault === true || (input.isDefault === undefined && existing.isDefault))
    const updated = await tx.shippingOrigin.update({
      where: { id: existing.id },
      data: {
        ...input,
        ...(input.enviopackAddressId !== undefined ? { enviopackAddressId: input.enviopackAddressId || null } : {}),
        isActive: active,
        isDefault: false,
      },
    })

    if (wantsDefault) {
      await tx.shippingOrigin.updateMany({ where: { isDefault: true }, data: { isDefault: false } })
      return tx.shippingOrigin.update({ where: { id: updated.id }, data: { isDefault: true } })
    }

    await ensureActiveDefault(tx)
    return tx.shippingOrigin.findUnique({ where: { id: updated.id } })
  })
  if (!origin) {
    res.status(404).json({ error: { code: 'SHIPPING_ORIGIN_NOT_FOUND', message: 'El depósito de despacho no existe.' } })
    return
  }
  res.json({ data: origin })
})

adminShippingOriginsRouter.delete('/:id', async (req, res) => {
  const deleted = await prisma.$transaction(async (tx) => {
    await lockDefaultOrigin(tx)
    const existing = await tx.shippingOrigin.findUnique({ where: { id: req.params.id } })
    if (!existing) return false

    await tx.shippingOrigin.delete({ where: { id: existing.id } })
    await ensureActiveDefault(tx)
    return true
  })
  if (!deleted) {
    res.status(404).json({ error: { code: 'SHIPPING_ORIGIN_NOT_FOUND', message: 'El depósito de despacho no existe.' } })
    return
  }
  res.status(204).send()
})
