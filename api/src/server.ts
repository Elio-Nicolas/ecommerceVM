import 'dotenv/config'
import { app } from './app'
import { env } from './config/env'
import { prisma } from './lib/prisma'
import { startEnviopackWebhookWorker, stopEnviopackWebhookWorker } from './services/enviopack-webhook-queue'

const initialCategories = [
  { name: 'Gadgets', slug: 'gadgets' },
  { name: 'Accesorios', slug: 'accesorios' },
  { name: 'Hogar inteligente', slug: 'hogar-inteligente' },
  { name: 'Foto y video', slug: 'foto-y-video' },
]

async function startServer() {
  // Safe, idempotent bootstrap: creates only missing starter categories.
  for (const category of initialCategories) {
    await prisma.category.upsert({
      where: { slug: category.slug },
      update: {},
      create: category,
    })
  }

  console.log('Categorías iniciales verificadas.')

  startEnviopackWebhookWorker()

  const server = app.listen(env.API_PORT, '0.0.0.0', () => {
    console.log(`ecommerceVM API escuchando en http://localhost:${env.API_PORT}`)
  })

  async function shutdown() {
    stopEnviopackWebhookWorker()
    server.close(async () => {
      await prisma.$disconnect()
      process.exit(0)
    })
  }

  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

startServer().catch(async (error) => {
  console.error('No se pudo iniciar ecommerceVM API:', error)
  await prisma.$disconnect()
  process.exit(1)
})
