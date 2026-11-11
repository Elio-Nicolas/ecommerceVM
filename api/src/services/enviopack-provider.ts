import { Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma'
import { getEnviopackCredentials } from './shipping-settings'
import { quoteHomeDelivery } from './enviopack'
import { createEnviopackShipment, downloadEnviopackLabel, refreshEnviopackShipment } from './enviopack-shipments'
import {
  ShippingProviderError,
  type ShippingProvider,
  type ShippingQuoteRequest,
  type ShippingQuoteOption,
  type ShippingParcel,
  type ShipmentAdmissionResult,
  type ShipmentRefreshResult,
} from './shipping-provider'

export const enviopackShippingProvider: ShippingProvider = {
  id: 'ENVIOPACK',

  async quoteHomeDelivery(input: ShippingQuoteRequest): Promise<ShippingQuoteOption[]> {
    const credentials = await getEnviopackCredentials()
    if (!credentials) {
      throw new ShippingProviderError('Envíopack no está habilitado o todavía no tiene credenciales configuradas en Administración > Envíos.')
    }

    try {
      return await quoteHomeDelivery({
        provinceCode: input.provinceCode,
        postalCode: input.postalCode,
        weightGrams: input.weightGrams,
        packages: input.packages,
        originAddressId: input.originReference,
        credentials,
      })
    } catch (error) {
      if (error instanceof Error) throw new ShippingProviderError(error.message)
      throw new ShippingProviderError('No se pudo cotizar el envío con Envíopack.')
    }
  },

  async createShipment(orderId: string, serviceSelection: string, parcels: ShippingParcel[]): Promise<ShipmentAdmissionResult> {
    try {
      const result = await createEnviopackShipment(orderId, serviceSelection, parcels.map((parcel) => ({
        alto: parcel.heightCm,
        ancho: parcel.widthCm,
        largo: parcel.lengthCm,
        peso: parcel.weightKg,
        descripcion_primera_linea: parcel.description,
        descripcion_segunda_linea: parcel.reference,
      })))
      const order = await prisma.order.findUnique({
        where: { id: orderId },
        select: { shippingService: true },
      })
      await prisma.shippingShipment.upsert({
        where: { orderId_provider: { orderId, provider: 'ENVIOPACK' } },
        create: {
          orderId,
          provider: 'ENVIOPACK',
          status: result.status,
          externalAdmissionId: result.shipmentId,
          serviceCode: order?.shippingService || null,
          parcels: parcels.map((parcel) => ({
            heightCm: parcel.heightCm,
            widthCm: parcel.widthCm,
            lengthCm: parcel.lengthCm,
            weightKg: parcel.weightKg,
            description: parcel.description || null,
            reference: parcel.reference || null,
          })) as Prisma.InputJsonArray,
          admittedAt: new Date(),
        },
        update: {
          status: result.status,
          externalAdmissionId: result.shipmentId,
          serviceCode: order?.shippingService || null,
          parcels: parcels.map((parcel) => ({
            heightCm: parcel.heightCm,
            widthCm: parcel.widthCm,
            lengthCm: parcel.lengthCm,
            weightKg: parcel.weightKg,
            description: parcel.description || null,
            reference: parcel.reference || null,
          })) as Prisma.InputJsonArray,
          admittedAt: new Date(),
          lastError: null,
        },
      })
      return result
    } catch (error) {
      if (error instanceof Error) throw new ShippingProviderError(error.message)
      throw new ShippingProviderError('No se pudo crear el envío con Envíopack.')
    }
  },

  async getLabel(shipmentReference: string): Promise<Buffer> {
    try {
      const pdf = await downloadEnviopackLabel(shipmentReference)
      await prisma.shippingShipment.updateMany({
        where: { provider: 'ENVIOPACK', externalAdmissionId: shipmentReference },
        data: { labelPdf: pdf, labelMimeType: 'application/pdf', lastError: null },
      })
      return pdf
    } catch (error) {
      if (error instanceof Error) throw new ShippingProviderError(error.message)
      throw new ShippingProviderError('No se pudo descargar la etiqueta de Envíopack.')
    }
  },

  async refreshShipment(shipmentReference: string): Promise<ShipmentRefreshResult> {
    try {
      const result = await refreshEnviopackShipment(shipmentReference)
      if (result) {
        const shipment = await prisma.shippingShipment.findFirst({
          where: { provider: 'ENVIOPACK', externalAdmissionId: shipmentReference },
          select: { id: true },
        })
        if (shipment) {
          await prisma.$transaction([
            prisma.shippingShipment.update({
              where: { id: shipment.id },
              data: {
                ...(result.status ? { status: result.status } : {}),
                ...(result.processed ? { processedAt: new Date() } : {}),
                lastError: null,
              },
            }),
            prisma.shippingShipmentEvent.create({
              data: {
                shipmentId: shipment.id,
                eventType: 'STATUS_REFRESH',
                status: 'PROCESSED',
                payload: { providerStatus: result.status, processed: result.processed, labelSaved: result.labelSaved },
                processedAt: new Date(),
              },
            }),
          ])
        }
      }
      return result
    } catch (error) {
      if (error instanceof Error) throw new ShippingProviderError(error.message)
      throw new ShippingProviderError('No se pudo actualizar el seguimiento de Envíopack.')
    }
  },
}
