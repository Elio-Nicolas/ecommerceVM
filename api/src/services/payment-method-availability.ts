export type ConfigurablePaymentMethod = 'CASH' | 'MERCADO_PAGO' | 'GOCUOTAS'

export interface PaymentMethodAvailabilitySettings {
  cashEnabled: boolean
  mercadoPagoEnabled: boolean
  goCuotasEnabled: boolean
}

/** Unknown methods fail closed; only explicitly supported methods can pass. */
export function isPaymentMethodEnabled(
  paymentMethod: string,
  settings: PaymentMethodAvailabilitySettings,
): boolean {
  switch (paymentMethod) {
    case 'CASH':
      return settings.cashEnabled
    case 'MERCADO_PAGO':
      return settings.mercadoPagoEnabled
    case 'GOCUOTAS':
      return settings.goCuotasEnabled
    default:
      return false
  }
}
