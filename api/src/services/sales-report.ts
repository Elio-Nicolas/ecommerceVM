export type SalesPaymentMethod = 'CASH' | 'MERCADO_PAGO' | 'GOCUOTAS'
export type SalesRefundStatus = 'NONE' | 'PARTIAL' | 'FULL'

export type SalesTransaction = {
  id: string
  orderId: string
  orderCode: string
  customerName: string
  customerPhone: string
  paymentMethod: SalesPaymentMethod
  amountArs: number
  paidAt: Date
  orderStatus: string
  deliveryMethod: string
  refundStatus: SalesRefundStatus
  refundAmountArs: number
  providerReference: string | null
  paymentStatus: string
  items: Array<{ productName: string; quantity: number; lineTotalArs: number }>
}

export const paymentMethodLabels: Record<SalesPaymentMethod, string> = {
  CASH: 'Efectivo / a coordinar',
  MERCADO_PAGO: 'Mercado Pago',
  GOCUOTAS: 'GOcuotas',
}

export function getSalesDateRange(fromValue?: string, toValue?: string, now = new Date()) {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(now)
  const from = fromValue || today
  const to = toValue || from
  const parse = (value: string) => {
    if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(value)) return null
    const date = new Date(`${value}T00:00:00-03:00`)
    return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? null : date
  }
  const start = parse(from)
  const endDate = parse(to)
  if (!start || !endDate || to < from) throw new Error('El período seleccionado no es válido.')
  const days = Math.floor((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1
  if (days > 366) throw new Error('El informe admite períodos de hasta 366 días.')
  const endExclusive = new Date(endDate.getTime() + 86_400_000)
  return { from, to, start, endExclusive, days }
}

export function salesDateKey(value: Date) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(value)
}

export function buildSalesReport(transactions: SalesTransaction[]) {
  const methods: SalesPaymentMethod[] = ['MERCADO_PAGO', 'GOCUOTAS', 'CASH']
  const byPaymentMethod = methods.map((method) => {
    const rows = transactions.filter((item) => item.paymentMethod === method)
    const grossCollectedArs = rows.reduce((sum, item) => sum + item.amountArs, 0)
    const fullyRefundedArs = rows.reduce((sum, item) => sum + item.refundAmountArs, 0)
    return {
      paymentMethod: method,
      label: paymentMethodLabels[method],
      transactions: rows.length,
      orders: new Set(rows.map((item) => item.orderId)).size,
      grossCollectedArs,
      fullyRefundedArs,
      netAfterFullRefundsArs: grossCollectedArs - fullyRefundedArs,
      partialRefunds: rows.filter((item) => item.refundStatus === 'PARTIAL').length,
    }
  })
  const byDay = new Map<string, Record<SalesPaymentMethod, number>>()
  for (const item of transactions) {
    const key = salesDateKey(item.paidAt)
    const current = byDay.get(key) || { CASH: 0, MERCADO_PAGO: 0, GOCUOTAS: 0 }
    current[item.paymentMethod] += item.amountArs
    byDay.set(key, current)
  }
  const grossCollectedArs = transactions.reduce((sum, item) => sum + item.amountArs, 0)
  const fullyRefundedArs = transactions.reduce((sum, item) => sum + item.refundAmountArs, 0)
  return {
    summary: {
      grossCollectedArs,
      fullyRefundedArs,
      netAfterFullRefundsArs: grossCollectedArs - fullyRefundedArs,
      transactions: transactions.length,
      orders: new Set(transactions.map((item) => item.orderId)).size,
      partialRefunds: transactions.filter((item) => item.refundStatus === 'PARTIAL').length,
      averageTicketArs: transactions.length ? Math.round(grossCollectedArs / new Set(transactions.map((item) => item.orderId)).size) : 0,
    },
    byPaymentMethod,
    byDay: [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, values]) => ({ date, ...values, totalArs: values.CASH + values.MERCADO_PAGO + values.GOCUOTAS })),
    transactions: [...transactions].sort((a, b) => b.paidAt.getTime() - a.paidAt.getTime()),
  }
}
