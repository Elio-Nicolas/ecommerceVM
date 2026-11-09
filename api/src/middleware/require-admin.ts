import type { RequestHandler } from 'express'
import jwt from 'jsonwebtoken'
import { env } from '../config/env'
type AdminToken = { sub: string; email: string; role: 'ADMIN' }
declare global {
  namespace Express {
    interface Request { admin?: { id: string; email: string } }
  }
}
export const requireAdmin: RequestHandler = (req, res, next) => {
  const authorization = req.header('authorization')
  const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : null
  if (!token) {
    res.status(401).json({ error: { code: 'AUTH_REQUIRED', message: 'Autenticación requerida' } })
    return
  }
  try {
    const payload = jwt.verify(token, env.JWT_SECRET) as AdminToken
    if (payload.role !== 'ADMIN' || !payload.sub) {
      res.status(401).json({ error: { code: 'INVALID_TOKEN', message: 'Sesión inválida' } })
      return
    }
    req.admin = { id: payload.sub, email: payload.email }
    next()
  } catch {
    res.status(401).json({ error: { code: 'INVALID_TOKEN', message: 'Sesión inválida o vencida' } })
  }
}
