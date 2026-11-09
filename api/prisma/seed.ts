import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const catalog = [
  { category: 'Gadgets', slug: 'gadgets', products: [
    { sku: 'GAD-001', slug: 'mini-impresora-termica-bluetooth', name: 'Mini impresora térmica Bluetooth', description: 'Imprimí notas, etiquetas y pequeños recordatorios desde tu celular. Compacta, inalámbrica y fácil de llevar.', priceArs: 48990, compareAtArs: 56990, badge: 'Más elegido', featured: true, imageUrl: 'https://images.unsplash.com/photo-1612198188060-c7c2a3b66eae?auto=format&fit=crop&w=900&q=85', specs: ['Conexión Bluetooth', 'Impresión térmica sin tinta', 'Diseño portátil'] },
    { sku: 'GAD-002', slug: 'proyector-de-estrellas', name: 'Proyector de estrellas', description: 'Convertí cualquier habitación en un espacio distinto con proyecciones ambientales.', priceArs: 36900, imageUrl: 'https://images.unsplash.com/photo-1534447677768-be436bb09401?auto=format&fit=crop&w=900&q=85', specs: ['Proyección ambiental', 'Múltiples efectos', 'Uso interior'] },
  ]},
  { category: 'Accesorios', slug: 'accesorios', products: [
    { sku: 'ACC-001', slug: 'mini-aspiradora-usb', name: 'Mini aspiradora USB', description: 'Una solución compacta para mantener limpios escritorios, teclados y rincones del auto.', priceArs: 27900, imageUrl: 'https://images.unsplash.com/photo-1527515637462-cff94eecc1ac?auto=format&fit=crop&w=900&q=85', specs: ['Alimentación USB', 'Formato compacto', 'Uso multipropósito'] },
    { sku: 'ACC-002', slug: 'cargador-inalambrico', name: 'Cargador inalámbrico', description: 'Cargá tus dispositivos compatibles con una base simple que mantiene tu escritorio ordenado.', priceArs: 32900, featured: true, imageUrl: 'https://images.unsplash.com/photo-1609592806596-b43bada2f7f0?auto=format&fit=crop&w=900&q=85', specs: ['Carga inalámbrica', 'Diseño minimalista', 'Indicador LED'] },
    { sku: 'ACC-003', slug: 'luz-led-sensor-movimiento', name: 'Luz LED con sensor de movimiento', description: 'Iluminación automática para placares, pasillos y espacios donde necesitás una luz rápida.', priceArs: 15900, badge: 'Práctico', imageUrl: 'https://images.unsplash.com/photo-1507473885765-e6ed057f782c?auto=format&fit=crop&w=900&q=85', specs: ['Sensor de movimiento', 'Instalación simple', 'Bajo consumo'] },
  ]},
  { category: 'Hogar inteligente', slug: 'hogar-inteligente', products: [
    { sku: 'HOG-001', slug: 'camara-wifi-inteligente', name: 'Cámara WiFi inteligente', description: 'Vigilá tus espacios desde el teléfono con una cámara compacta y conectada.', priceArs: 54900, compareAtArs: 61900, featured: true, imageUrl: 'https://images.unsplash.com/photo-1558002038-1055907df827?auto=format&fit=crop&w=900&q=85', specs: ['Conexión WiFi', 'Visión nocturna', 'Acceso desde app'] },
    { sku: 'HOG-002', slug: 'interruptor-inteligente-wifi', name: 'Interruptor inteligente WiFi', description: 'Controlá luces y dispositivos desde el celular o integralo a tus rutinas inteligentes.', priceArs: 23900, imageUrl: 'https://images.unsplash.com/photo-1558008258-3256797b43f3?auto=format&fit=crop&w=900&q=85', specs: ['Control remoto', 'Programación horaria', 'Instalación compacta'] },
    { sku: 'HOG-003', slug: 'tira-led-rgb', name: 'Tira LED RGB', description: 'Dale otra atmósfera a tus ambientes con iluminación de colores configurable.', priceArs: 18900, badge: 'Precio especial', imageUrl: 'https://images.unsplash.com/photo-1550684848-fac1c5b4e853?auto=format&fit=crop&w=900&q=85', specs: ['Colores RGB', 'Modos dinámicos', 'Fácil instalación'] },
  ]},
  { category: 'Foto y video', slug: 'foto-y-video', products: [
    { sku: 'FOT-001', slug: 'tripode-seguimiento-facial', name: 'Trípode con seguimiento facial', description: 'Un soporte inteligente que acompaña tus movimientos para grabar contenido con las manos libres.', priceArs: 62900, badge: 'Novedad', featured: true, imageUrl: 'https://images.unsplash.com/photo-1606983340126-99ab4feaa64a?auto=format&fit=crop&w=900&q=85', specs: ['Seguimiento automático', 'Rotación inteligente', 'Control remoto'] },
    { sku: 'FOT-002', slug: 'microfono-inalambrico-compacto', name: 'Micrófono inalámbrico compacto', description: 'Mejorá el audio de tus videos, entrevistas y transmisiones con un micrófono pequeño y práctico.', priceArs: 41900, imageUrl: 'https://images.unsplash.com/photo-1590602847861-f357a9332bbc?auto=format&fit=crop&w=900&q=85', specs: ['Conexión inalámbrica', 'Reducción de ruido', 'Estuche de carga'] },
  ]},
]

async function main() {
  for (const group of catalog) {
    const category = await prisma.category.upsert({
      where: { slug: group.slug },
      update: { name: group.category },
      create: { name: group.category, slug: group.slug },
    })

    for (const item of group.products) {
      await prisma.product.upsert({
        where: { sku: item.sku },
        update: { ...item, categoryId: category.id, status: 'ACTIVE' },
        create: { ...item, categoryId: category.id, status: 'ACTIVE' },
      })
    }
  }
  console.log('Catálogo de demostración sincronizado: 10 productos.')
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => prisma.$disconnect())
