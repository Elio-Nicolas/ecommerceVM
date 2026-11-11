import { getEnviopackCredentials } from './shipping-settings'
import { quoteHomeDelivery } from './enviopack'
import {
  ShippingProviderError,
  type ShippingProvider,
  type ShippingQuoteRequest,
  type ShippingQuoteOption,
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
}
