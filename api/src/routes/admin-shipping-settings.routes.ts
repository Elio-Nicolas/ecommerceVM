import { Router } from 'express'
import { z } from 'zod'
import { requireAdmin } from '../middleware/require-admin'
import { getShippingSettings, saveShippingSettings } from '../services/shipping-settings'

export const adminShippingSettingsRouter = Router()
adminShippingSettingsRouter.use(requireAdmin)
function publicSettings(settings: Awaited<ReturnType<typeof getShippingSettings>>) {
  return {
    ocaEnvironment: settings.ocaEnvironment,
    ocaConfigured: Boolean(settings.ocaUsernameEncrypted && settings.ocaPasswordEncrypted && settings.ocaCuitEncrypted && settings.ocaOperativeEncrypted),
    pickupEnabled: settings.pickupEnabled, pickupAddress: settings.pickupAddress, pickupInstructions: settings.pickupInstructions,
    localDeliveryEnabled: settings.localDeliveryEnabled, localDeliveryPostalCodes: settings.localDeliveryPostalCodes,
    localDeliveryFeeArs: settings.localDeliveryFeeArs, localDeliveryInternalCostArs: settings.localDeliveryInternalCostArs,
    localDeliveryCoordinate: settings.localDeliveryCoordinate,
  }
}
adminShippingSettingsRouter.get('/', async (_req, res) => res.json({ data: publicSettings(await getShippingSettings()) }))
const schema = z.object({
  ocaEnvironment: z.enum(['QA', 'PRODUCTION']),
  ocaUsername: z.string().trim().min(1).max(200).optional(),
  ocaPassword: z.string().trim().min(1).max(300).optional(),
  ocaCuit: z.string().trim().regex(/^\d{11}$/, 'El CUIT OCA debe tener 11 dígitos.').optional(),
  ocaOperative: z.string().trim().min(1).max(100).optional(),
  clearOcaCredentials: z.boolean().optional(),
  pickupEnabled: z.boolean(), pickupAddress: z.string().trim().min(3).max(250), pickupInstructions: z.string().trim().max(1000),
  localDeliveryEnabled: z.boolean(), localDeliveryPostalCodes: z.array(z.string().trim().regex(/^\d{4}$/)).max(100),
  localDeliveryFeeArs: z.number().int().min(0).max(2_000_000_000),
  localDeliveryInternalCostArs: z.number().int().min(0).max(2_000_000_000).nullable(),
  localDeliveryCoordinate: z.boolean(),
}).superRefine((value, ctx) => {
  if (new Set(value.localDeliveryPostalCodes).size !== value.localDeliveryPostalCodes.length) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['localDeliveryPostalCodes'], message: 'No repitas códigos postales.' })
  if (value.localDeliveryEnabled && value.localDeliveryPostalCodes.length === 0) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['localDeliveryPostalCodes'], message: 'Indicá al menos un código postal para habilitar la entrega local.' })
})
adminShippingSettingsRouter.put('/', async (req, res) => {
  const input = schema.parse(req.body)
  try { res.json({ data: publicSettings(await saveShippingSettings(input)) }) }
  catch (error) { res.status(400).json({ error: { code: 'SHIPPING_SETTINGS_INVALID', message: error instanceof Error ? error.message : 'No se pudo guardar la configuración.' } }) }
})
