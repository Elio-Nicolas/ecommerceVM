import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import { requireAdmin } from '../middleware/require-admin'
import { getOcaLabelPdf, OcaLabelError } from '../services/oca-label'
import { getCancellationFulfillmentBlockMessage, isCancellationBlockingFulfillment } from '../services/fulfillment-policy'

export const adminShippingLabelsRouter = Router()
adminShippingLabelsRouter.use(requireAdmin)

adminShippingLabelsRouter.get('/orders/:orderId/oca', async (req, res) => {
  const parsedId = z.string().uuid().safeParse(req.params.orderId)
  if (!parsedId.success) {
    res.status(400).json({ error: { code: 'ORDER_ID_INVALID', message: 'El identificador del pedido no es válido.' } })
    return
  }

  const order = await prisma.order.findUnique({
    where: { id: parsedId.data },
    select: { id: true, code: true, status: true, deliveryMethod: true, cancellationRequest: { select: { status: true, returnStatus: true } } },
  })
  if (!order) {
    res.status(404).json({ error: { code: 'ORDER_NOT_FOUND', message: 'Pedido no encontrado.' } })
    return
  }
  if (isCancellationBlockingFulfillment(order.cancellationRequest)) {
    res.status(409).json({ error: { code: 'CANCELLATION_REQUEST_PENDING', message: getCancellationFulfillmentBlockMessage() } })
    return
  }
  if (order.deliveryMethod !== 'OCA' || order.status === 'CANCELLED') {
    res.status(409).json({ error: { code: 'OCA_LABEL_NOT_AVAILABLE', message: 'El pedido no corresponde a un envío OCA activo.' } })
    return
  }

  const shipment = await prisma.shippingShipment.findUnique({
    where: { orderId_provider: { orderId: order.id, provider: 'OCA' } },
    select: { id: true, status: true, externalAdmissionId: true, trackingNumber: true, labelPdf: true },
  })
  if (!shipment) {
    res.status(409).json({ error: { code: 'OCA_SHIPMENT_NOT_ADMITTED', message: 'Todavía no existe una admisión OCA registrada para este pedido.' } })
    return
  }

  let pdf = shipment.labelPdf
  if (!pdf) {
    if (!shipment.externalAdmissionId) {
      res.status(409).json({ error: { code: 'OCA_ADMISSION_ID_MISSING', message: 'El envío no tiene identificador de admisión OCA. No se puede solicitar la etiqueta.' } })
      return
    }
    try {
      pdf = await getOcaLabelPdf({
        admissionId: shipment.externalAdmissionId,
        trackingNumber: shipment.trackingNumber,
      })
      await prisma.shippingShipment.update({
        where: { id: shipment.id },
        data: { labelPdf: pdf, labelMimeType: 'application/pdf', lastError: null },
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo recuperar la etiqueta OCA.'
      await prisma.shippingShipment.update({
        where: { id: shipment.id },
        data: { lastError: message.slice(0, 400) },
      }).catch(() => undefined)
      const statusCode = error instanceof OcaLabelError ? error.statusCode : 502
      res.status(statusCode).json({ error: { code: 'OCA_LABEL_DOWNLOAD_FAILED', message } })
      return
    }
  }

  const filename = (order.code.replace(/[^A-Za-z0-9-]/g, '') || 'pedido') + '-oca.pdf'
  res.setHeader('Content-Type', 'application/pdf')
  res.setHeader('Content-Disposition', 'inline; filename="' + filename + '"')
  res.setHeader('Content-Length', String(pdf.length))
  res.setHeader('Cache-Control', 'private, no-store')
  res.send(pdf)
})
