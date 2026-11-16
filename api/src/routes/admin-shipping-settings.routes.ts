import { Router } from 'express'
import { z } from 'zod'
import { requireAdmin } from '../middleware/require-admin'
import { getShippingSettings, getStoredAndreaniCredentials, saveShippingSettings } from '../services/shipping-settings'
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

adminShippingSettingsRouter.post('/andreani/test', async (_req, res) => {
  try {
    const credentials = await getStoredAndreaniCredentials()
    if (!credentials) {
      res.status(503).json({ error: { code: 'ANDREANI_NOT_CONFIGURED', message: 'Completá usuario, contraseña, código de cliente y contrato de Andreani antes de probar la conexión.' } })
      return
    }
    if (credentials.environment !== 'QA') {
      res.status(409).json({ error: { code: 'ANDREANI_QA_REQUIRED', message: 'La prueba de conexión está limitada a QA. No se ejecutó ninguna llamada a producción.' } })
      return
    }
    // Pass the exact QA credential snapshot validated above; a concurrent settings
    // change cannot redirect this diagnostic request to the production endpoint.
    res.json({ data: await testAndreaniConnection(credentials), message: 'Conexión con Andreani verificada en QA.' })
  } catch (error) {
    res.status(error instanceof AndreaniError ? error.statusCode : 502).json({
      error: { code: 'ANDREANI_CONNECTION_ERROR', message: error instanceof Error ? error.message : 'No se pudo validar Andreani en QA.' },
    })
  }
})

const schema = z.object({
  ocaEnvironment: z.enum(['QA', 'PRODUCTION']),
  ocaUsername: z.string().trim().min(1).max(200).optional(),
  ocaPassword: z.string().trim().min(1).max(300).optional(),
  ocaCuit: z.string().trim().regex(/^\\d{11}$/, 'El CUIT OCA debe tener 11 dígitos.').optional(),
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
  localDeliveryPostalCodes: z.array(z.string().trim().regex(/^\\d{4}$/)).max(100),
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
