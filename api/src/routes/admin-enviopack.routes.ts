import { Router } from 'express'
import { z } from 'zod'
import { requireAdmin } from '../middleware/require-admin'
import { prisma } from '../lib/prisma'
import {
  createEnviopackShipment,
  downloadEnviopackLabel,
  EnviopackShipmentError,
  refreshEnviopackShipment,
} from '../services/enviopack-shipments'

export const adminEnviopackRouter = Router()
adminEnviopackRouter.use(requireAdmin)

adminEnviopackRouter.post('/orders/:id/create', async (req, res) => {
  const input = z.object({ carrierId: z.string().trim().min(1).max(100) }).parse(req.body)
  try {
    const result = await createEnviopackShipment(req.params.id, input.carrierId)
    res.status(201).json({ data: result, message: 'Envío creado en Envíopack. La etiqueta estará disponible cuando el correo lo procese.' })
  } catch (error) {
    if (error instanceof EnviopackShipmentError) {
      res.status(409).json({ error: { code: 'ENVIOPACK_SHIPMENT_ERROR', message: error.message } })
      return
    }
    throw error
  }
})

adminEnviopackRouter.get('/orders/:id/label', async (req, res) => {
  const order = await prisma.order.findUnique({ where: { id: req.params.id } })
  if (!order?.enviopackShipmentId) {
    res.status(404).json({ error: { code: 'ENVIOPACK_SHIPMENT_NOT_FOUND', message: 'El pedido todavía no tiene un envío creado en Envíopack.' } })
    return
  }
  if (order.enviopackShipmentStatus !== 'P') {
    res.status(409).json({ error: { code: 'ENVIOPACK_LABEL_NOT_READY', message: 'La etiqueta estará disponible cuando Envíopack confirme el procesamiento del envío.' } })
    return
  }
  try {
    const pdf = await downloadEnviopackLabel(order.enviopackShipmentId)
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `attachment; filename="etiqueta-${order.code}.pdf"`)
    res.setHeader('Content-Length', pdf.length)
    res.send(pdf)
  } catch (error) {
    const message = error instanceof EnviopackShipmentError ? error.message : 'No se pudo descargar la etiqueta.'
    res.status(502).json({ error: { code: 'ENVIOPACK_LABEL_ERROR', message } })
  }
})

adminEnviopackRouter.post('/orders/:id/refresh', async (req, res) => {
  const order = await prisma.order.findUnique({ where: { id: req.params.id } })
  if (!order?.enviopackShipmentId) {
    res.status(404).json({ error: { code: 'ENVIOPACK_SHIPMENT_NOT_FOUND', message: 'El pedido todavía no tiene un envío creado en Envíopack.' } })
    return
  }
  try {
    const result = await refreshEnviopackShipment(order.enviopackShipmentId)
    res.json({ data: result })
  } catch (error) {
    const message = error instanceof EnviopackShipmentError ? error.message : 'No se pudo consultar el estado del envío.'
    res.status(502).json({ error: { code: 'ENVIOPACK_REFRESH_ERROR', message } })
  }
})

export const enviopackWebhookRouter = Router()
enviopackWebhookRouter.get('/', (req, res) => {
  const input = z.object({
    id: z.string().trim().min(1).max(80),
    tipo: z.enum(['envio-procesado', 'envio-cambio-condicion']),
  }).safeParse(req.query)
  if (!input.success) {
    res.status(400).send('Parámetros inválidos')
    return
  }
  res.status(200).send('OK')
  void refreshEnviopackShipment(input.data.id).catch((error) => {
    console.error('No se pudo sincronizar la notificación de Envíopack:', error)
  })
})
