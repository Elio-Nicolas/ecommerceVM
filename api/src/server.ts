import 'dotenv/config'
import { app } from './app'
import { env } from './config/env'
import { prisma } from './lib/prisma'

const server = app.listen(env.API_PORT, '0.0.0.0', () => {
  console.log(`ecommerceVM API escuchando en http://localhost:${env.API_PORT}`)
})

async function shutdown() {
  server.close(async () => {
    await prisma.$disconnect()
    process.exit(0)
  })
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
