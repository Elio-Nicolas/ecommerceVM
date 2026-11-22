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

export interface ArcaReceiverIdentityInput {
  totalAmountArs: number
  documentType?: number | null
  documentNumber?: string | null
  name?: string | null
  address?: string | null
}

export type ArcaReceiverIdentityResult =
  | { ok: true; documentType: number; documentNumber: string; name: string; address: string }
  | { ok: false; code: 'RECEIVER_AMOUNT_INVALID' | 'RECEIVER_ID_REQUIRED' | 'RECEIVER_ID_INVALID' }

/**
 * RG 1415, Anexo II (texto vigente): a consumidor final se identifica
 * desde ARS 10.000.000 inclusive. The caller must still obtain the current
 * CondicionIVAReceptorId from FEParamGetCondicionIvaReceptor.
 */
export function resolveArcaReceiverIdentity(input: ArcaReceiverIdentityInput): ArcaReceiverIdentityResult {
  if (!Number.isSafeInteger(input.totalAmountArs) || input.totalAmountArs <= 0) {
    return { ok: false, code: 'RECEIVER_AMOUNT_INVALID' }
  }
  const documentNumber = input.documentNumber?.replace(/\D/g, '') ?? ''
  const documentType = input.documentType ?? null
  if (documentType !== null || documentNumber.length > 0) {
    if (documentType === null || !documentNumber || !/^\d{1,20}$/.test(documentNumber)) {
      return { ok: false, code: 'RECEIVER_ID_INVALID' }
    }
    return {
      ok: true,
      documentType,
      documentNumber,
      name: input.name?.trim() || 'NR',
      address: input.address?.trim() || 'NR',
    }
  }
  if (input.totalAmountArs >= 10_000_000) {
    return { ok: false, code: 'RECEIVER_ID_REQUIRED' }
  }
  return {
    ok: true,
    documentType: 99,
    documentNumber: '0',
    name: 'A CONSUMIDOR FINAL',
    address: 'NR',
  }
}
