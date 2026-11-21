export type CancellationStateForFulfillment = { status: string; returnStatus?: string } | null | undefined

const blockingCancellationStatuses = new Set(['REQUESTED', 'PROCESSING', 'FAILED'])

/** A regret/refund request must stop any fulfillment step until it is resolved. */
export function isCancellationBlockingFulfillment(request: CancellationStateForFulfillment): boolean {
  return Boolean(request && (blockingCancellationStatuses.has(request.status) || (request.returnStatus && request.returnStatus !== 'NOT_REQUIRED')))
}

export function getCancellationFulfillmentBlockMessage(): string {
  return 'El pedido tiene una solicitud de arrepentimiento o reintegro pendiente. No puede iniciar la preparación ni el despacho hasta resolverla. Si ya estaba en tránsito, registrá la entrega real y gestioná la devolución física.'
}
