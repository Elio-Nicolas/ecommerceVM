export function wouldChangeOrderTotal(
  subtotalArs: number,
  shippingCostArs: number,
  currentTotalArs: number | null,
): boolean {
  const nextTotalArs = subtotalArs + shippingCostArs
  return !Number.isSafeInteger(nextTotalArs) || nextTotalArs !== currentTotalArs
}
