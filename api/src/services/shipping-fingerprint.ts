import { createHash } from 'node:crypto'

export function shippingCartFingerprint(
  items: Array<{ productId: string; quantity: number }>,
  products: Array<{
    id: string
    priceArs: number
    weightGrams: number | null
    packageLengthCm: number | null
    packageWidthCm: number | null
    packageHeightCm: number | null
  }>,
) {
  const byId = new Map(products.map((product) => [product.id, product]))
  const canonical = [...items].sort((a, b) => a.productId.localeCompare(b.productId))
    .map((item) => {
      const product = byId.get(item.productId)
      return [
        item.productId, item.quantity, product?.priceArs, product?.weightGrams,
        product?.packageLengthCm, product?.packageWidthCm, product?.packageHeightCm,
      ].join(':')
    }).join('|')
  return createHash('sha256').update(canonical).digest('hex')
}
