import { Router } from 'express'
import { z } from 'zod'
import { requireAdmin } from '../middleware/require-admin'
import { getStoredEnviopackCredentials, getShippingSettings, saveShippingSettings } from '../services/shipping-settings'
import { testEnviopackCredentials, ShippingProviderError } from '../services/enviopack'

export const adminShippingSettingsRouter = Router()
adminShippingSettingsRouter.use(requireAdmin)

adminShippingSettingsRouter.get('/', async (_req, res) => {
  const settings = await getShippingSettings()
  res.json({
    data: {
      enviopackEnabled: settings.enviopackEnabled,
      enviopackConfigured: Boolean(settings.enviopackApiKeyEncrypted && settings.enviopackSecretKeyEncrypted),
      ocaEnvironment: settings.ocaEnvironment,
      ocaConfigured: Boolean(settings.ocaUsernameEncrypted && settings.ocaPasswordEncrypted && settings.ocaCuitEncrypted && settings.ocaOperativeEncrypted),
      pickupEnabled: settings.pickupEnabled,
      pickupAddress: settings.pickupAddress,
      pickupInstructions: settings.pickupInstructions,
      localDeliveryEnabled: settings.localDeliveryEnabled,
      localDeliveryPostalCodes: settings.localDeliveryPostalCodes,
      localDeliveryFeeArs: settings.localDeliveryFeeArs,
      localDeliveryInternalCostArs: settings.localDeliveryInternalCostArs,
      localDeliveryCoordinate: settings.localDeliveryCoordinate,
    },
  })
})


adminShippingSettingsRouter.post('/test', async (req, res) => {
  const input = z.object({
    apiKey: z.string().trim().min(1).max(300).optional(),
    secretKey: z.string().trim().min(1).max(300).optional(),
  }).parse(req.body)
  if (Boolean(input.apiKey) !== Boolean(input.secretKey)) {
    res.status(400).json({ error: { code: 'SHIPPING_CREDENTIALS_INCOMPLETE', message: 'Ingresá la API Key y la Secret Key juntas.' } })
    return
  }
  try {
    const credentials = input.apiKey && input.secretKey
      ? { apiKey: input.apiKey, secretKey: input.secretKey }
      : await getStoredEnviopackCredentials()
    if (!credentials) {
      res.status(400).json({ error: { code: 'SHIPPING_CREDENTIALS_MISSING', message: 'Ingresá y guardá las credenciales de Envíopack antes de probar la conexión.' } })
      return
    }
    await testEnviopackCredentials(credentials)
    res.json({ data: { connected: true }, message: 'Conexión con Envíopack verificada correctamente.' })
  } catch (error) {
    const message = error instanceof ShippingProviderError ? error.message : 'No se pudo verificar la conexión con Envíopack.'
    res.status(502).json({ error: { code: 'SHIPPING_CONNECTION_FAILED', message } })
  }
})

const schema = z.object({
  enviopackEnabled: z.boolean(),
  enviopackApiKey: z.string().trim().max(300).optional(),
  enviopackSecretKey: z.string().trim().max(300).optional(),
  clearEnviopackCredentials: z.boolean().optional(),
  ocaEnvironment: z.enum(['QA', 'PRODUCTION']).optional(),
  ocaUsername: z.string().trim().min(1).max(200).optional(),
  ocaPassword: z.string().trim().min(1).max(300).optional(),
  ocaCuit: z.string().trim().regex(/^\\d{11}$/, 'El CUIT OCA debe tener 11 dígitos.').optional(),
  ocaOperative: z.string().trim().min(1).max(100).optional(),
  clearOcaCredentials: z.boolean().optional(),
  pickupEnabled: z.boolean(),
  pickupAddress: z.string().trim().min(3).max(250),
  pickupInstructions: z.string().trim().max(1000),
  localDeliveryEnabled: z.boolean(),
  localDeliveryPostalCodes: z.array(z.string().trim().regex(/^\d{4}$/)).max(100),
  localDeliveryFeeArs: z.number().int().min(0).max(2_000_000_000),
  localDeliveryInternalCostArs: z.number().int().min(0).max(2_000_000_000).nullable(),
  localDeliveryCoordinate: z.boolean(),
}).superRefine((value, ctx) => {
  if (new Set(value.localDeliveryPostalCodes).size !== value.localDeliveryPostalCodes.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['localDeliveryPostalCodes'], message: 'No repitas códigos postales.' })
  }
  if (value.localDeliveryEnabled && value.localDeliveryPostalCodes.length === 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['localDeliveryPostalCodes'], message: 'Indicá al menos un código postal para habilitar la entrega local.' })
  }
})

adminShippingSettingsRouter.put('/', async (req, res) => {
  const input = schema.parse(req.body)
  try {
    const settings = await saveShippingSettings(input)
    res.json({
      data: {
        enviopackEnabled: settings.enviopackEnabled,
        enviopackConfigured: Boolean(settings.enviopackApiKeyEncrypted && settings.enviopackSecretKeyEncrypted),
        ocaEnvironment: settings.ocaEnvironment,
        ocaConfigured: Boolean(settings.ocaUsernameEncrypted && settings.ocaPasswordEncrypted && settings.ocaCuitEncrypted && settings.ocaOperativeEncrypted),
        pickupEnabled: settings.pickupEnabled,
        pickupAddress: settings.pickupAddress,
        pickupInstructions: settings.pickupInstructions,
        localDeliveryEnabled: settings.localDeliveryEnabled,
        localDeliveryPostalCodes: settings.localDeliveryPostalCodes,
        localDeliveryFeeArs: settings.localDeliveryFeeArs,
        localDeliveryInternalCostArs: settings.localDeliveryInternalCostArs,
        localDeliveryCoordinate: settings.localDeliveryCoordinate,
      },
    })
  } catch (error) {
    res.status(400).json({ error: { code: 'SHIPPING_SETTINGS_INVALID', message: error instanceof Error ? error.message : 'No se pudo guardar la configuración.' } })
  }
})
