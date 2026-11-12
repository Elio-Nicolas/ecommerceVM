import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'
import { config } from 'dotenv'

config()

const prisma = new PrismaClient()

async function main() {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase()
  const password = process.env.ADMIN_PASSWORD

  if (!email || !password) {
    throw new Error('Definí ADMIN_EMAIL y ADMIN_PASSWORD para crear el administrador inicial.')
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('ADMIN_EMAIL no tiene un formato válido.')
  }
  if (password.length < 12) {
    throw new Error('ADMIN_PASSWORD debe tener al menos 12 caracteres.')
  }

  const existing = await prisma.adminUser.findUnique({ where: { email }, select: { id: true } })
  if (existing) {
    console.log('El administrador ya existe. No se modificó su contraseña ni el catálogo.')
    return
  }

  const passwordHash = await bcrypt.hash(password, 12)
  await prisma.adminUser.create({ data: { email, passwordHash, isActive: true } })
  console.log('Administrador inicial creado. No se modificó el catálogo.')
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => prisma.$disconnect())
