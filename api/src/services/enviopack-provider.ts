import { getEnviopackCredentials } from './shipping-settings'
import { quoteHomeDelivery } from './enviopack'
import { createEnviopackShipment, downloadEnviopackLabel, EnviopackShipmentError, refreshEnviopackShipment } from './enviopack-shipments'
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
      return await createEnviopackShipment(orderId, serviceSelection, parcels.map((parcel) => ({
        alto: parcel.heightCm,
        ancho: parcel.widthCm,
        largo: parcel.lengthCm,
        peso: parcel.weightKg,
        descripcion_primera_linea: parcel.description,
        descripcion_segunda_linea: parcel.reference,
      })))
    } catch (error) {
      if (error instanceof Error) throw new ShippingProviderError(error.message)
      throw new ShippingProviderError('No se pudo crear el envío con Envíopack.')
    }
  },

  async getLabel(shipmentReference: string): Promise<Buffer> {
    try {
      return await downloadEnviopackLabel(shipmentReference)
    } catch (error) {
      if (error instanceof Error) throw new ShippingProviderError(error.message)
      throw new ShippingProviderError('No se pudo descargar la etiqueta de Envíopack.')
    }
  },

  async refreshShipment(shipmentReference: string): Promise<ShipmentRefreshResult> {
    try {
      return await refreshEnviopackShipment(shipmentReference)
    } catch (error) {
      if (error instanceof Error) throw new ShippingProviderError(error.message)
      throw new ShippingProviderError('No se pudo actualizar el seguimiento de Envíopack.')
    }
  },
}
