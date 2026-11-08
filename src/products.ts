export type Product = {
  id: number
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

export const products: Product[] = [
  {
    id: 1, name: 'Mini impresora térmica Bluetooth', category: 'Gadgets',
    price: 48990, oldPrice: 56990, badge: 'Más elegido', featured: true,
    description: 'Imprimí notas, etiquetas y pequeños recordatorios desde tu celular. Compacta, inalámbrica y fácil de llevar.',
    image: 'https://images.unsplash.com/photo-1612198188060-c7c2a3b66eae?auto=format&fit=crop&w=900&q=85',
    specs: ['Conexión Bluetooth', 'Impresión térmica sin tinta', 'Diseño portátil'],
  },
  {
    id: 2, name: 'Trípode con seguimiento facial', category: 'Foto y video',
    price: 62900, badge: 'Novedad', featured: true,
    description: 'Un soporte inteligente que acompaña tus movimientos para grabar contenido con las manos libres.',
    image: 'https://images.unsplash.com/photo-1606983340126-99ab4feaa64a?auto=format&fit=crop&w=900&q=85',
    specs: ['Seguimiento automático', 'Rotación inteligente', 'Control remoto'],
  },
  {
    id: 3, name: 'Cámara WiFi inteligente', category: 'Hogar inteligente',
    price: 54900, oldPrice: 61900, featured: true,
    description: 'Vigilá tus espacios desde el teléfono con una cámara compacta y conectada.',
    image: 'https://images.unsplash.com/photo-1558002038-1055907df827?auto=format&fit=crop&w=900&q=85',
    specs: ['Conexión WiFi', 'Visión nocturna', 'Acceso desde app'],
  },
  {
    id: 4, name: 'Interruptor inteligente WiFi', category: 'Hogar inteligente',
    price: 23900,
    description: 'Controlá luces y dispositivos desde el celular o integralo a tus rutinas inteligentes.',
    image: 'https://images.unsplash.com/photo-1558008258-3256797b43f3?auto=format&fit=crop&w=900&q=85',
    specs: ['Control remoto', 'Programación horaria', 'Instalación compacta'],
  },
  {
    id: 5, name: 'Tira LED RGB', category: 'Hogar inteligente',
    price: 18900, badge: 'Precio especial',
    description: 'Dale otra atmósfera a tus ambientes con iluminación de colores configurable.',
    image: 'https://images.unsplash.com/photo-1550684848-fac1c5b4e853?auto=format&fit=crop&w=900&q=85',
    specs: ['Colores RGB', 'Modos dinámicos', 'Fácil instalación'],
  },
  {
    id: 6, name: 'Mini aspiradora USB', category: 'Accesorios',
    price: 27900,
    description: 'Una solución compacta para mantener limpios escritorios, teclados y rincones del auto.',
    image: 'https://images.unsplash.com/photo-1527515637462-cff94eecc1ac?auto=format&fit=crop&w=900&q=85',
    specs: ['Alimentación USB', 'Formato compacto', 'Uso multipropósito'],
  },
  {
    id: 7, name: 'Cargador inalámbrico', category: 'Accesorios',
    price: 32900, featured: true,
    description: 'Cargá tus dispositivos compatibles con una base simple que mantiene tu escritorio ordenado.',
    image: 'https://images.unsplash.com/photo-1609592806596-b43bada2f7f0?auto=format&fit=crop&w=900&q=85',
    specs: ['Carga inalámbrica', 'Diseño minimalista', 'Indicador LED'],
  },
  {
    id: 8, name: 'Micrófono inalámbrico compacto', category: 'Foto y video',
    price: 41900,
    description: 'Mejorá el audio de tus videos, entrevistas y transmisiones con un micrófono pequeño y práctico.',
    image: 'https://images.unsplash.com/photo-1590602847861-f357a9332bbc?auto=format&fit=crop&w=900&q=85',
    specs: ['Conexión inalámbrica', 'Reducción de ruido', 'Estuche de carga'],
  },
  {
    id: 9, name: 'Proyector de estrellas', category: 'Gadgets',
    price: 36900,
    description: 'Convertí cualquier habitación en un espacio distinto con proyecciones ambientales.',
    image: 'https://images.unsplash.com/photo-1534447677768-be436bb09401?auto=format&fit=crop&w=900&q=85',
    specs: ['Proyección ambiental', 'Múltiples efectos', 'Uso interior'],
  },
  {
    id: 10, name: 'Luz LED con sensor de movimiento', category: 'Accesorios',
    price: 15900, badge: 'Práctico',
    description: 'Iluminación automática para placares, pasillos y espacios donde necesitás una luz rápida.',
    image: 'https://images.unsplash.com/photo-1507473885765-e6ed057f782c?auto=format&fit=crop&w=900&q=85',
    specs: ['Sensor de movimiento', 'Instalación simple', 'Bajo consumo'],
  },
]

export const categories = ['Todos', 'Gadgets', 'Accesorios', 'Hogar inteligente', 'Foto y video']
export const formatPrice = (price: number) =>
  new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(price)
