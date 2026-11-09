import type { Product } from './products'

const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:7381').replace(/\/$/, '')

type ApiProduct = {
  id: string
  name: string
  slug: string
  stock: number
  description: string
  priceArs: number
  compareAtArs: number | null
  status: string
  featured: boolean
  badge: string | null
  imageUrl: string | null
  specs: string[]
  category: { name: string }
}

type ApiList<T> = { data: T[] }

async function get<T>(path: string): Promise<T> {
  const response = await fetch(`${API_URL}/api/v1${path}`, { cache: 'no-store' })
  if (!response.ok) throw new Error(`API error: ${response.status}`)
  return response.json() as Promise<T>
}

export async function fetchProducts(): Promise<Product[]> {
  const response = await get<ApiList<ApiProduct>>('/products?limit=48&page=1&sort=featured')
  return response.data.map((item) => ({
    id: item.id,
    slug: item.slug,
    stock: item.stock,
    name: item.name,
    category: item.category.name,
    price: item.priceArs,
    oldPrice: item.compareAtArs ?? undefined,
    badge: item.badge ?? undefined,
    description: item.description,
    image: item.imageUrl || '',
    specs: item.specs,
    featured: item.featured,
  }))
}

export async function fetchCategories(): Promise<string[]> {
  const response = await get<ApiList<{ name: string }>>('/categories')
  return response.data.map((category) => category.name)
}
