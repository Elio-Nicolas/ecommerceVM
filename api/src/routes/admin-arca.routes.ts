import { Router } from 'express'
import { rateLimit } from 'express-rate-limit'
import { z } from 'zod'
import type { ArcaEnvironment } from '@prisma/client'
import { env } from '../config/env'
import { prisma } from '../lib/prisma'
import { requireAdmin } from '../middleware/require-admin'
import { getArcaAccessTicket } from '../services/arca-wsaa'
import { getArcaIvaReceiverConditions, getArcaLastAuthorizedVoucher, getArcaPointsOfSale, getArcaVoucherTypes } from '../services/arca-wsfe-readonly'

export const adminArcaRouter = Router()
adminArcaRouter.use(requireAdmin)

const settingsResponse = (settings: { enabled: boolean; environment: ArcaEnvironment; pointOfSale: number | null }) => ({
  enabled: settings.enabled,
  environment: settings.environment,
  pointOfSale: settings.pointOfSale,
  cuitConfigured: Boolean(env.ARCA_CUIT),
  certificateConfigured: Boolean(env.ARCA_CERTIFICATE_PATH && env.ARCA_PRIVATE_KEY_PATH),
  credentialsConfigured: Boolean(env.ARCA_CUIT && env.ARCA_CERTIFICATE_PATH && env.ARCA_PRIVATE_KEY_PATH),
})

async function getSettings() {
  return prisma.arcaSettings.upsert({
    where: { id: 'default' },
    create: { id: 'default' },
    update: {},
  })
}

adminArcaRouter.get('/settings', async (_req, res) => {
  const settings = await getSettings()
  res.json({ data: settingsResponse(settings) })
})

const settingsSchema = z.object({
  enabled: z.boolean(),
  environment: z.literal('HOMOLOGATION'),
  pointOfSale: z.number().int().min(1).max(99_998).nullable(),
})

adminArcaRouter.put('/settings', async (req, res) => {
  const input = settingsSchema.parse(req.body)
  const credentialsConfigured = Boolean(env.ARCA_CUIT && env.ARCA_CERTIFICATE_PATH && env.ARCA_PRIVATE_KEY_PATH)

  if (input.enabled && (!credentialsConfigured || input.pointOfSale === null)) {
    res.status(409).json({
      error: {
        code: 'ARCA_CONFIGURATION_INCOMPLETE',
        message: 'Para habilitar ARCA necesitás configurar CUIT, certificado, clave privada y punto de venta.',
      },
    })
    return
  }

  const settings = await prisma.arcaSettings.upsert({
    where: { id: 'default' },
    create: { id: 'default', ...input },
    update: input,
  })
  res.json({ data: settingsResponse(settings), message: 'Configuración de ARCA guardada.' })
})

const testLimiter = rateLimit({ windowMs: 60 * 1000, limit: 3, standardHeaders: 'draft-8', legacyHeaders: false })

adminArcaRouter.post('/settings/test', testLimiter, async (_req, res) => {
  const settings = await getSettings()
  if (!settings.pointOfSale) {
    res.status(409).json({
      error: { code: 'ARCA_POINT_OF_SALE_MISSING', message: 'Configurá el punto de venta antes de probar la conexión.' },
    })
    return
  }

  try {
    const ticket = await getArcaAccessTicket('HOMOLOGATION')
    res.json({
      data: { connected: true, expiresAt: ticket.expiresAt.toISOString() },
      message: 'Conexión con ARCA homologación verificada correctamente.',
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'No se pudo verificar la conexión con ARCA.'
    res.status(502).json({ error: { code: 'ARCA_CONNECTION_FAILED', message } })
  }
})


const diagnosticsLimiter = rateLimit({ windowMs: 60 * 1000, limit: 2, standardHeaders: 'draft-8', legacyHeaders: false })

// Consulta únicamente información de homologación. Nunca autoriza comprobantes.
adminArcaRouter.get('/diagnostics', diagnosticsLimiter, async (_req, res) => {
  const settings = await getSettings()
  if (!settings.pointOfSale) {
    res.status(409).json({
      error: { code: 'ARCA_POINT_OF_SALE_MISSING', message: 'Guardá el punto de venta antes de consultar los datos de ARCA.' },
    })
    return
  }
  if (!env.ARCA_CUIT || !env.ARCA_CERTIFICATE_PATH || !env.ARCA_PRIVATE_KEY_PATH) {
    res.status(409).json({
      error: { code: 'ARCA_CREDENTIALS_MISSING', message: 'Falta configurar el CUIT, el certificado y la clave privada en la API.' },
    })
    return
  }

  try {
    const [pointsOfSale, voucherTypes, ivaReceiverConditions] = await Promise.all([
      getArcaPointsOfSale('HOMOLOGATION'),
      getArcaVoucherTypes('HOMOLOGATION'),
      getArcaIvaReceiverConditions('HOMOLOGATION', 'C'),
    ])
    const selectedPoint = pointsOfSale.find((point) => point.number === settings.pointOfSale)
    const lastAuthorized = selectedPoint && !selectedPoint.blocked
      ? await getArcaLastAuthorizedVoucher('HOMOLOGATION', settings.pointOfSale, 11)
      : null

    res.json({
      data: {
        pointOfSale: settings.pointOfSale,
        pointsOfSale,
        selectedPointFound: Boolean(selectedPoint),
        lastAuthorized,
        voucherTypes,
        ivaReceiverConditions,
        queriedAt: new Date().toISOString(),
      },
      message: 'Consultas de solo lectura completadas en ARCA homologación.',
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'No se pudieron consultar los datos de ARCA.'
    res.status(502).json({ error: { code: 'ARCA_DIAGNOSTICS_FAILED', message } })
  }
})
