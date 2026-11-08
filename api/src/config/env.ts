import { z } from 'zod'

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(7381),
  CORS_ORIGIN: z.string().url().default('http://localhost:5287'),
  DATABASE_URL: z.string().min(1),
})

export const env = envSchema.parse(process.env)
