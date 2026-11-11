import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'
import { config } from 'dotenv'

config()

const prisma = new PrismaClient()

async function main() {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase()
  const password = process.env.ADMIN_PASSWORD

  if (!email || !password || password.length < 12) {
    throw new Error('Definí ADMIN_EMAIL y ADMIN_PASSWORD (mínimo 12 caracteres) antes de crear el administrador.')
  }

  const passwordHash = await bcrypt.hash(password, 12)
  await prisma.adminUser.upsert({
    where: { email },
    update: { passwordHash, isActive: true },
    create: { email, passwordHash },
  })
  console.log('Administrador configurado. No se modificó el catálogo.')
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => prisma.$disconnect())
