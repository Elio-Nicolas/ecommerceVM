import { z } from 'zod'
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(7381),
  CORS_ORIGIN: z.string().url().default('http://localhost:5287'),
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32),
  ADMIN_EMAIL: z.string().email().optional(),
  ADMIN_PASSWORD: z.string().min(12).optional(),
  SUPABASE_URL: z.string().url().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20).optional(),
  SUPABASE_BUCKET: z.string().min(1).default('product-images'),
  ENVIOPACK_API_KEY: z.string().min(1).optional(),
  ENVIOPACK_SECRET_KEY: z.string().min(1).optional(),
})
export const env = envSchema.parse(process.env)
