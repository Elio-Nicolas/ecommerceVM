import { Router } from 'express'
import { z } from 'zod'
import { requireAdmin } from '../middleware/require-admin'
import { getPaymentMethodSettings, savePaymentMethodSettings } from '../services/payment-method-settings'

export const adminPaymentSettingsRouter = Router()
adminPaymentSettingsRouter.use(requireAdmin)

adminPaymentSettingsRouter.get('/', async (_req, res) => {
  const settings = await getPaymentMethodSettings()
  res.setHeader('Cache-Control', 'no-store')
  res.json({ data: settings })
})

const schema = z.object({
  mercadoPagoEnabled: z.boolean(),
  goCuotasEnabled: z.boolean(),
  naranjaXEnabled: z.boolean(),
})

adminPaymentSettingsRouter.put('/', async (req, res) => {
  const input = schema.safeParse(req.body)
  if (!input.success) {
    res.status(400).json({ error: { code: 'PAYMENT_SETTINGS_INVALID', message: 'La configuración de medios de pago no es válida.' } })
    return
  }
  const settings = await savePaymentMethodSettings(input.data)
  res.setHeader('Cache-Control', 'no-store')
  res.json({ data: settings, message: 'Medios de pago actualizados.' })
})
