export type ShippingProviderId = 'ENVIOPACK' | 'OCA'

export type ShippingPackageDimensions = {
  lengthCm: number
  widthCm: number
  heightCm: number
}

export type ShippingQuoteRequest = {
  provinceCode: string
  postalCode: string
  weightGrams: number
  packages: ShippingPackageDimensions[]
  originReference?: string | null
}

export type ShippingQuoteOption = {
  key: string
  carrierName: string
  carrierId: string | null
  serviceCode: string
  serviceLabel: string
  priceArs: number
  estimatedHours: number | null
  sellerOptions: Array<{
    carrierId: string
    carrierName: string
    costArs: number
    estimatedHours: number | null
    fulfillmentMode: string
  }>
  sellerCostStatus: 'AVAILABLE' | 'UNAVAILABLE'
}

export type ShippingParcel = {
  heightCm: number
  widthCm: number
  lengthCm: number
  weightKg: number
  description?: string
  reference?: string
}

export type ShipmentAdmissionResult = {
  shipmentId: string
  status: string
}

export type ShipmentRefreshResult = {
  orderId: string
  status: string | null
  processed: boolean
  labelSaved: boolean
} | null

export interface ShippingProvider {
  readonly id: ShippingProviderId
  quoteHomeDelivery(input: ShippingQuoteRequest): Promise<ShippingQuoteOption[]>
  createShipment(orderId: string, serviceSelection: string, parcels: ShippingParcel[]): Promise<ShipmentAdmissionResult>
  getLabel(shipmentReference: string): Promise<Buffer>
  refreshShipment(shipmentReference: string): Promise<ShipmentRefreshResult>
}

export class ShippingProviderError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ShippingProviderError'
  }
}
