import { Router } from 'express'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { z } from 'zod'
import { env } from '../config/env'
import { prisma } from '../lib/prisma'
import { requireAdmin } from '../middleware/require-admin'
export const authRouter = Router()
const loginSchema = z.object({
  email: z.string().email().transform((value) => value.toLowerCase().trim()),
  password: z.string().min(1).max(200),
})
authRouter.post('/login', async (req, res) => {
  const { email, password } = loginSchema.parse(req.body)
  const admin = await prisma.adminUser.findUnique({ where: { email } })
  if (!admin || !admin.isActive || !(await bcrypt.compare(password, admin.passwordHash))) {
    res.status(401).json({ error: { code: 'INVALID_CREDENTIALS', message: 'Correo o contraseña incorrectos' } })
    return
  }
  const token = jwt.sign({ email: admin.email, role: 'ADMIN' }, env.JWT_SECRET, { subject: admin.id, expiresIn: '8h' })
  res.json({ data: { token, expiresIn: 28800, admin: { id: admin.id, email: admin.email } } })
})
authRouter.get('/me', requireAdmin, async (req, res) => {
  res.json({ data: req.admin })
})
