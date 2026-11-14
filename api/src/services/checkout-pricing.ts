export type CheckoutPaymentMethod = 'CASH' | 'MERCADO_PAGO' | 'GOCUOTAS'

export type CheckoutPrice = {
  paymentMethod: CheckoutPaymentMethod
  subtotalArs: number
  shippingArs: number
  surchargeRateBps: number
  surchargeArs: number
  totalArs: number
}

const MAX_ORDER_AMOUNT_ARS = 2_000_000_000
const GOCUOTAS_SURCHARGE_BPS = 11979

function assertValidAmount(value: number, label: string) {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_ORDER_AMOUNT_ARS) {
    throw new Error(label + ' debe ser un importe entero no negativo dentro del límite permitido.')
  }
}

export function calculateCheckoutPrice(input: {
  paymentMethod: CheckoutPaymentMethod
  subtotalArs: number
  shippingArs: number
  mercadoPagoSurchargeBps?: number
}): CheckoutPrice {
  assertValidAmount(input.subtotalArs, 'El subtotal')
  assertValidAmount(input.shippingArs, 'El envío')

  const baseArs = input.subtotalArs + input.shippingArs
  assertValidAmount(baseArs, 'El total base')

  let surchargeRateBps = 0
  if (input.paymentMethod === 'GOCUOTAS') surchargeRateBps = GOCUOTAS_SURCHARGE_BPS
  if (input.paymentMethod === 'MERCADO_PAGO') {
    surchargeRateBps = input.mercadoPagoSurchargeBps ?? 0
  }
  if (!Number.isSafeInteger(surchargeRateBps) || surchargeRateBps < 0 || surchargeRateBps > 100_000) {
    throw new Error('La tasa de recargo configurada no es válida.')
  }

  const surchargeArs = Math.round(baseArs * surchargeRateBps / 100_000)
  const totalArs = baseArs + surchargeArs
  assertValidAmount(surchargeArs, 'El recargo')
  assertValidAmount(totalArs, 'El total final')

  return {
    paymentMethod: input.paymentMethod,
    subtotalArs: input.subtotalArs,
    shippingArs: input.shippingArs,
    surchargeRateBps,
    surchargeArs,
    totalArs,
  }
}
