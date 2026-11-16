import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import { requireAdmin } from '../middleware/require-admin'
import { getShippingSettings, getStoredOcaCredentials, saveShippingSettings } from '../services/shipping-settings'
import { quoteOca, OcaError } from '../services/oca'
import { testAndreaniConnection, AndreaniError } from '../services/andreani'

export const adminShippingSettingsRouter = Router()
adminShippingSettingsRouter.use(requireAdmin)

function publicSettings(settings: Awaited<ReturnType<typeof getShippingSettings>>) {
  return {
    ocaEnvironment: settings.ocaEnvironment,
    ocaConfigured: Boolean(settings.ocaUsernameEncrypted && settings.ocaPasswordEncrypted && settings.ocaCuitEncrypted && settings.ocaOperativeEncrypted),
    andreaniEnvironment: settings.andreaniEnvironment,
    andreaniConfigured: Boolean(settings.andreaniUsernameEncrypted && settings.andreaniPasswordEncrypted && settings.andreaniClientCodeEncrypted && settings.andreaniContractEncrypted),
    pickupEnabled: settings.pickupEnabled,
    pickupAddress: settings.pickupAddress,
    pickupInstructions: settings.pickupInstructions,
    localDeliveryEnabled: settings.localDeliveryEnabled,
    localDeliveryPostalCodes: settings.localDeliveryPostalCodes,
    localDeliveryFeeArs: settings.localDeliveryFeeArs,
    localDeliveryInternalCostArs: settings.localDeliveryInternalCostArs,
    localDeliveryCoordinate: settings.localDeliveryCoordinate,
  }
}

adminShippingSettingsRouter.get('/', async (_req, res) => res.json({ data: publicSettings(await getShippingSettings()) }))

adminShippingSettingsRouter.post('/oca/test', async (_req, res) => {
  try {
    const credentials = await getStoredOcaCredentials()
    if (!credentials) {
      res.status(503).json({ error: { code: 'OCA_NOT_CONFIGURED', message: 'Completá usuario, contraseña, CUIT y operativa de OCA antes de probar la conexión.' } })
      return
    }
    if (credentials.environment !== 'QA') {
      res.status(409).json({ error: { code: 'OCA_QA_REQUIRED', message: 'La prueba de conexión está limitada a QA. No se ejecutó ninguna llamada a producción.' } })
      return
    }
    const origin = await prisma.shippingOrigin.findFirst({ where: { isActive: true, isDefault: true } })
    if (!origin) {
      res.status(409).json({ error: { code: 'OCA_ORIGIN_REQUIRED', message: 'Configurá un origen de despacho activo y predeterminado antes de probar OCA.' } })
      return
    }
    // Tariff lookup is read-only: it does not create an admission or confirm a pickup.
    const quote = await quoteOca({
      postalCode: origin.postalCode,
      originPostalCode: origin.postalCode,
      weightGrams: 1000,
      volumeCm3: 1000,
      packages: 1,
      declaredValueArs: 1000,
    }, credentials)
    res.json({
      data: { environment: credentials.environment, serviceCode: quote.serviceCode, priceArs: quote.priceArs, estimatedHours: quote.estimatedHours },
      message: 'OCA respondió correctamente a una consulta de tarifa de prueba en QA. No se creó ningún envío.',
    })
  } catch (error) {
    const statusCode = error instanceof OcaError ? error.statusCode : 502
    res.status(statusCode).json({
      error: { code: 'OCA_CONNECTION_ERROR', message: error instanceof Error ? error.message : 'No se pudo validar OCA en QA.' },
    })
  }
})

adminShippingSettingsRouter.post('/andreani/test', async (_req, res) => {
  try {
    res.json({ data: await testAndreaniConnection(), message: 'Conexión con Andreani verificada.' })
  } catch (error) {
    res.status(error instanceof AndreaniError ? error.statusCode : 502).json({
      error: { code: 'ANDREANI_CONNECTION_ERROR', message: error instanceof Error ? error.message : 'No se pudo validar Andreani.' },
    })
  }
})

const schema = z.object({
  ocaEnvironment: z.enum(['QA', 'PRODUCTION']),
  ocaUsername: z.string().trim().min(1).max(200).optional(),
  ocaPassword: z.string().trim().min(1).max(300).optional(),
  ocaCuit: z.string().trim().regex(/^\d{11}$/, 'El CUIT OCA debe tener 11 dígitos.').optional(),
  ocaOperative: z.string().trim().min(1).max(100).optional(),
  clearOcaCredentials: z.boolean().optional(),
  andreaniEnvironment: z.enum(['QA', 'PRODUCTION']),
  andreaniUsername: z.string().trim().min(1).max(200).optional(),
  andreaniPassword: z.string().trim().min(1).max(300).optional(),
  andreaniClientCode: z.string().trim().min(1).max(100).optional(),
  andreaniContract: z.string().trim().min(1).max(100).optional(),
  clearAndreaniCredentials: z.boolean().optional(),
  pickupEnabled: z.boolean(),
  pickupAddress: z.string().trim().min(3).max(250),
  pickupInstructions: z.string().trim().max(1000),
  localDeliveryEnabled: z.boolean(),
  localDeliveryPostalCodes: z.array(z.string().trim().regex(/^\d{4}$/)).max(100),
  localDeliveryFeeArs: z.number().int().min(0).max(2_000_000_000),
  localDeliveryInternalCostArs: z.number().int().min(0).max(2_000_000_000).nullable(),
  localDeliveryCoordinate: z.boolean(),
}).superRefine((value, ctx) => {
  if (new Set(value.localDeliveryPostalCodes).size !== value.localDeliveryPostalCodes.length) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['localDeliveryPostalCodes'], message: 'No repitas códigos postales.' })
  if (value.localDeliveryEnabled && value.localDeliveryPostalCodes.length === 0) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['localDeliveryPostalCodes'], message: 'Indicá al menos un código postal para habilitar la entrega local.' })
})

adminShippingSettingsRouter.put('/', async (req, res) => {
  const input = schema.parse(req.body)
  try {
    res.json({ data: publicSettings(await saveShippingSettings(input)) })
  } catch (error) {
    res.status(400).json({ error: { code: 'SHIPPING_SETTINGS_INVALID', message: error instanceof Error ? error.message : 'No se pudo guardar la configuración.' } })
  }
})
