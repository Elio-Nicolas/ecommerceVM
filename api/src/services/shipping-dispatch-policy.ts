export type ShippingDispatchCandidate = {
  deliveryMethod: string
  shippingService?: string | null
  shippingCostArs?: number | null
  shipments?: Array<{ provider: string; status: string; trackingNumber: string | null }>
}

export type ShippingDispatchBlock = {
  code: 'OCA_SHIPMENT_NOT_PROCESSED' | 'ANDREANI_SHIPMENT_NOT_PROCESSED' | 'LOCAL_DELIVERY_COST_REQUIRED'
  message: string
}

/**
 * Returns a blocking reason before an order can move to SHIPPED.
 * Keep this policy pure so both the early HTTP check and the transactional
 * recheck use exactly the same rules.
 */
export function getShippingDispatchBlock(order: ShippingDispatchCandidate): ShippingDispatchBlock | null {
  if (order.deliveryMethod === 'OCA') {
    const admitted = order.shipments?.some((shipment) =>
      shipment.provider === 'OCA' && shipment.status === 'PROCESSED' && Boolean(shipment.trackingNumber?.trim()),
    )
    return admitted ? null : {
      code: 'OCA_SHIPMENT_NOT_PROCESSED',
      message: 'El pedido solo puede marcarse como enviado cuando OCA confirme la admisión y exista un número de seguimiento.',
    }
  }

  if (order.deliveryMethod === 'ANDREANI') {
    const admitted = order.shipments?.some((shipment) =>
      shipment.provider === 'ANDREANI' && shipment.status === 'PROCESSED' && Boolean(shipment.trackingNumber?.trim()),
    )
    return admitted ? null : {
      code: 'ANDREANI_SHIPMENT_NOT_PROCESSED',
      message: 'El pedido solo puede marcarse como enviado cuando Andreani confirme la admisión y exista un número de seguimiento.',
    }
  }

  if (order.deliveryMethod === 'LOCAL_DELIVERY' && order.shippingService === 'A coordinar' && order.shippingCostArs == null) {
    return {
      code: 'LOCAL_DELIVERY_COST_REQUIRED',
      message: 'Antes de despachar el pedido, registrá el costo de entrega local acordado con el comprador.',
    }
  }

  return null
}
