export function paymentAmountsMatchCurrentOrder(
  providerAmount: number | null,
  attemptAmount: number,
  currentOrderTotal: number | null,
): boolean {
  return providerAmount !== null
    && Number.isSafeInteger(attemptAmount)
    && attemptAmount > 0
    && currentOrderTotal !== null
    && Number.isSafeInteger(currentOrderTotal)
    && providerAmount === attemptAmount
    && providerAmount === currentOrderTotal
}
