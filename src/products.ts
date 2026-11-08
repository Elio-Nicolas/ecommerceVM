export type Product = {
  id: string
  name: string
  category: string
  price: number
  oldPrice?: number
  badge?: string
  description: string
  image: string
  specs: string[]
  featured?: boolean
}

export const formatPrice = (price: number) =>
  new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(price)
