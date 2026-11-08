import { randomUUID } from 'node:crypto'
import { Router } from 'express'
import multer from 'multer'
import { createClient } from '@supabase/supabase-js'
import { env } from '../config/env'
import { requireAdmin } from '../middleware/require-admin'

export const adminStorageRouter = Router()
adminStorageRouter.use(requireAdmin)

const allowedTypes: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/avif': 'avif',
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, callback) => {
    if (!allowedTypes[file.mimetype]) {
      callback(new Error('Formato no permitido. Usá JPG, PNG, WebP o AVIF.'))
      return
    }
    callback(null, true)
  },
})

adminStorageRouter.post('/images', upload.single('image'), async (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: { code: 'IMAGE_REQUIRED', message: 'Seleccioná una imagen para subir.' } })
    return
  }
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    res.status(503).json({ error: { code: 'STORAGE_NOT_CONFIGURED', message: 'La integración con Supabase Storage no está configurada en la API.' } })
    return
  }

  const extension = allowedTypes[req.file.mimetype]
  const objectPath = `products/${randomUUID()}.${extension}`
  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { error } = await supabase.storage.from(env.SUPABASE_BUCKET).upload(objectPath, req.file.buffer, {
    contentType: req.file.mimetype,
    cacheControl: '31536000',
    upsert: false,
  })
  if (error) {
    res.status(502).json({ error: { code: 'STORAGE_UPLOAD_FAILED', message: 'Supabase no pudo guardar la imagen.' } })
    return
  }

  const { data } = supabase.storage.from(env.SUPABASE_BUCKET).getPublicUrl(objectPath)
  res.status(201).json({ data: { imageUrl: data.publicUrl, path: objectPath } })
})
