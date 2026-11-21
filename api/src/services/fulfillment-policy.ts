export type CancellationStateForFulfillment = { status: string } | null | undefined

const blockingCancellationStatuses = new Set(['REQUESTED', 'PROCESSING', 'FAILED'])

/** A regret/refund request must stop any fulfillment step until it is resolved. */
export function isCancellationBlockingFulfillment(request: CancellationStateForFulfillment): boolean {
  return Boolean(request && blockingCancellationStatuses.has(request.status))
}

export function getCancellationFulfillmentBlockMessage(): string {
  return 'El pedido tiene una solicitud de arrepentimiento o reintegro pendiente. No puede prepararse, despacharse ni entregarse hasta resolverla.'
}
