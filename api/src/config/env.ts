import { z } from 'zod'

const optionalTrimmedString = (minimumLength: number) => z.preprocess(
  (value) => typeof value === 'string' && value.trim() === '' ? undefined : value,
  z.string().trim().min(minimumLength).optional(),
)
const optionalHttpsUrl = z.preprocess(
  (value) => typeof value === 'string' && value.trim() === '' ? undefined : value,
  z.string().trim().url().refine((value) => new URL(value).protocol === 'https:', 'La URL pública debe usar HTTPS.').optional(),
)

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(7381),
  CORS_ORIGIN: z.string().default('http://localhost:5287')
    .transform((value) => value.split(',').map((origin) => origin.trim()).filter(Boolean))
    .pipe(z.array(z.string().url()).min(1)),
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32),
  SHIPPING_ENCRYPTION_KEY: optionalTrimmedString(32),
  ARCA_CUIT: z.string().regex(/^\d{11}$/).optional(),
  ARCA_ISSUER_NAME: optionalTrimmedString(2),
  ARCA_ISSUER_ADDRESS: optionalTrimmedString(5),
  ARCA_ISSUER_VAT_CONDITION: optionalTrimmedString(2),
  ARCA_CERTIFICATE_PATH: z.string().min(1).optional(),
  ARCA_PRIVATE_KEY_PATH: z.string().min(1).optional(),
  ARCA_OPENSSL_PATH: z.string().min(1).default('openssl'),
  MP_ACCESS_TOKEN: optionalTrimmedString(20),
  MP_WEBHOOK_SECRET: optionalTrimmedString(20),
  MP_CHECKOUT_SURCHARGE_MILLIPERCENT: z.coerce.number().int().min(0).max(100000).default(0), // Milésimas de punto porcentual; 5000 = 5%.
  GOCUOTAS_API_BASE_URL: optionalHttpsUrl,
  GOCUOTAS_EMAIL: optionalTrimmedString(5),
  GOCUOTAS_PASSWORD: optionalTrimmedString(8),
  PUBLIC_APP_URL: optionalHttpsUrl,
  PUBLIC_API_URL: optionalHttpsUrl,
  ADMIN_EMAIL: z.string().email().optional(),
  ADMIN_PASSWORD: z.string().min(12).optional(),
  SUPABASE_URL: z.string().url().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20).optional(),
  SUPABASE_BUCKET: z.string().min(1).default('product-images'),
  PICKUP_ENABLED: z.enum(['true', 'false']).default('true').transform((value) => value === 'true'),
  PICKUP_ADDRESS: z.string().default('Domicilio del vendedor'),
  PICKUP_INSTRUCTIONS: z.string().default('La dirección exacta y el horario se coordinarán luego de confirmar el pedido.'),
  LOCAL_DELIVERY_ENABLED: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
  LOCAL_DELIVERY_POSTAL_CODES: z.string().default('5730'),
  LOCAL_DELIVERY_FEE_ARS: z.coerce.number().int().min(0).max(2_000_000_000).default(0),
  LOCAL_DELIVERY_INTERNAL_COST_ARS: z.coerce.number().int().min(0).max(2_000_000_000).optional(),
  LOCAL_DELIVERY_COORDINATE: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
})
export const env = envSchema.parse(process.env)
