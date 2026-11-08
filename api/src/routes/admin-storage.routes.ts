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

adminStorageRouter.post('/images', (req, res, next) => {
  upload.single('image')(req, res, (error: unknown) => {
    if (error instanceof multer.MulterError) {
      res.status(error.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ error: { code: error.code, message: error.code === 'LIMIT_FILE_SIZE' ? 'La imagen supera el límite de 5 MB.' : 'No se pudo procesar el archivo.' } })
      return
    }
    if (error) {
      res.status(400).json({ error: { code: 'INVALID_IMAGE', message: error instanceof Error ? error.message : 'Archivo no válido.' } })
      return
    }
    next()
  })
}, async (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: { code: 'IMAGE_REQUIRED', message: 'Seleccioná una imagen para subir.' } })
    return
  }
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    res.status(503).json({ error: { code: 'STORAGE_NOT_CONFIGURED', message: 'La integración con Supabase Storage no está configurada en la API.' } })
    return
  }

  const buffer = req.file.buffer
  const isJpeg = buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff
  const isPng = buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  const isWebp = buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP'
  const isAvif = buffer.length >= 12 && buffer.toString('ascii', 4, 12).startsWith('ftypavif')
  const signatureMatches = req.file.mimetype === 'image/jpeg' ? isJpeg : req.file.mimetype === 'image/png' ? isPng : req.file.mimetype === 'image/webp' ? isWebp : req.file.mimetype === 'image/avif' ? isAvif : false
  if (!signatureMatches) {
    res.status(400).json({ error: { code: 'INVALID_IMAGE_CONTENT', message: 'El contenido del archivo no coincide con su formato declarado.' } })
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
