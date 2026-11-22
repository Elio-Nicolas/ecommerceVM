export type FiscalPaymentStatus = 'CREATING' | 'PENDING' | 'UNKNOWN' | 'APPROVED' | 'REJECTED' | 'CANCELLED' | 'REFUNDED' | 'PARTIALLY_REFUNDED'
export type FiscalOrderStatus = 'PENDING' | 'CONFIRMED' | 'PREPARING' | 'SHIPPED' | 'DELIVERED' | 'CANCELLED'
export type FiscalInvoiceStatus = 'PENDING' | 'ISSUING' | 'AUTHORIZED' | 'REJECTED' | 'UNKNOWN'
export type FiscalCancellationStatus = 'REQUESTED' | 'PROCESSING' | 'REFUNDED' | 'FAILED' | null
export type FiscalReturnStatus = 'NOT_REQUIRED' | 'RETURN_PENDING' | 'RETURN_RECEIVED' | 'RETURN_ACCEPTED'

export type FiscalAutomationAction =
  | 'WAIT_PAYMENT'
  | 'HOLD_CANCEL_REQUEST'
  | 'HOLD_CANCELLED_ORDER'
  | 'RECONCILE_INVOICE'
  | 'ISSUE_INVOICE'
  | 'NOOP_INVOICE_EXISTS'
  | 'WAIT_REFUND'
  | 'RECONCILE_REFUND'
  | 'HOLD_RETURN_INSPECTION'
  | 'ISSUE_FULL_CREDIT_NOTE'
  | 'ISSUE_PARTIAL_CREDIT_NOTE'
  | 'NOOP_CREDIT_NOTE_EXISTS'
  | 'NO_FISCAL_DOCUMENT_REQUIRED'

export interface FiscalAutomationInput {
  paymentStatus: FiscalPaymentStatus
  orderStatus: FiscalOrderStatus
  cancellationStatus: FiscalCancellationStatus
  returnStatus: FiscalReturnStatus
  invoiceStatus: FiscalInvoiceStatus | null
  invoiceTotalArs: number | null
  refundedAmountArs: number
  existingCreditNoteAmountArs: number
  refundProviderConfirmed: boolean
}

/**
 * Pure decision policy. It never calls ARCA or a payment provider.
 * The caller must supply reconciled provider states and persist each action idempotently.
 */
export function decideFiscalAutomation(input: FiscalAutomationInput): FiscalAutomationAction {
  if (input.paymentStatus !== 'APPROVED' && input.paymentStatus !== 'PARTIALLY_REFUNDED' && input.paymentStatus !== 'REFUNDED') {
    return 'WAIT_PAYMENT'
  }

  if (input.invoiceStatus === 'PENDING' || input.invoiceStatus === 'ISSUING' || input.invoiceStatus === 'UNKNOWN') {
    return 'RECONCILE_INVOICE'
  }

  if (input.orderStatus === 'CANCELLED' && input.refundedAmountArs <= 0) {
    return 'HOLD_CANCELLED_ORDER'
  }

  if (input.cancellationStatus === 'REQUESTED' || input.cancellationStatus === 'PROCESSING') {
    return 'HOLD_CANCEL_REQUEST'
  }

  const hasConfirmedRefund = input.refundProviderConfirmed
    && input.refundedAmountArs > 0
    && (input.paymentStatus === 'REFUNDED' || input.paymentStatus === 'PARTIALLY_REFUNDED' || input.cancellationStatus === 'REFUNDED')

  if (input.refundedAmountArs > 0 && !hasConfirmedRefund) {
    return 'WAIT_REFUND'
  }

  if (input.invoiceStatus === 'AUTHORIZED' && hasConfirmedRefund) {
    if (input.orderStatus === 'SHIPPED' || input.orderStatus === 'DELIVERED') {
      if (input.returnStatus === 'RETURN_PENDING' || input.returnStatus === 'RETURN_RECEIVED') {
        return 'HOLD_RETURN_INSPECTION'
      }
    }

    const invoiceTotal = input.invoiceTotalArs ?? 0
    if (invoiceTotal <= 0 || input.refundedAmountArs > invoiceTotal) {
      return 'RECONCILE_REFUND'
    }
    if (input.existingCreditNoteAmountArs >= input.refundedAmountArs) {
      return 'NOOP_CREDIT_NOTE_EXISTS'
    }
    if (input.refundedAmountArs === invoiceTotal) return 'ISSUE_FULL_CREDIT_NOTE'
    return 'ISSUE_PARTIAL_CREDIT_NOTE'
  }

  if (input.invoiceStatus === 'AUTHORIZED') return 'NOOP_INVOICE_EXISTS'
  if (input.invoiceStatus === 'REJECTED') return 'RECONCILE_INVOICE'

  if (input.refundedAmountArs > 0 && hasConfirmedRefund && input.invoiceStatus === null) {
    return 'NO_FISCAL_DOCUMENT_REQUIRED'
  }

  if (input.orderStatus === 'CANCELLED') return 'HOLD_CANCELLED_ORDER'
  if (input.cancellationStatus) return 'HOLD_CANCEL_REQUEST'
  return 'ISSUE_INVOICE'
}
