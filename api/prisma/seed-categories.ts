import { PrismaClient } from '@prisma/client'
import { config } from 'dotenv'

config()

const prisma = new PrismaClient()

const categories = [
  { name: 'Gadgets', slug: 'gadgets' },
  { name: 'Accesorios', slug: 'accesorios' },
  { name: 'Hogar inteligente', slug: 'hogar-inteligente' },
  { name: 'Foto y video', slug: 'foto-y-video' },
]

async function main() {
  for (const category of categories) {
    await prisma.category.upsert({
      where: { slug: category.slug },
      update: {},
      create: category,
    })
  }

  const total = await prisma.category.count()
  console.log(`Categorías iniciales verificadas: ${categories.length}. Total de categorías en la base: ${total}.`)
  console.log('No se crearon ni modificaron productos ni usuarios administradores.')
}

main()
  .catch((error) => {
    console.error('Error al inicializar categorías:', error)
    process.exitCode = 1
  })
  .finally(async () => prisma.$disconnect())
