export interface ArcaInvoiceRequestIdentity {
  orderId: string
  type: string
}

export function matchesArcaInvoiceRequest(
  existing: ArcaInvoiceRequestIdentity,
  orderId: string,
): boolean {
  return existing.orderId === orderId && existing.type === 'INVOICE_C'
}
