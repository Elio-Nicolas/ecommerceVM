import { createHash } from 'node:crypto'
import { getStoredAndreaniCredentials } from './shipping-settings'

export class AndreaniError extends Error {
  constructor(message: string, readonly statusCode = 502) {
    super(message)
    this.name = 'AndreaniError'
  }
}

type AndreaniEnvironment = 'QA' | 'PRODUCTION'
type AndreaniCredentials = NonNullable<Awaited<ReturnType<typeof getStoredAndreaniCredentials>>>

const baseUrls: Record<AndreaniEnvironment, string> = {
  QA: 'https://apisqa.andreani.com',
  PRODUCTION: 'https://apis.andreani.com',
}
let cachedToken: { key: string; token: string; expiresAt: number } | null = null

async function readJson(response: Response): Promise<any> {
  const text = await response.text()
  if (!text) return null
  try { return JSON.parse(text) } catch { throw new AndreaniError('Andreani devolvió una respuesta que no es JSON.') }
}

async function login(credentials: AndreaniCredentials) {
  const key = createHash('sha256').update([credentials.environment, credentials.username, credentials.password].join(':')).digest('hex')
  if (cachedToken?.key === key && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.token
  let response: Response
  try {
    response = await fetch(`${baseUrls[credentials.environment]}/v2/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ usuario: credentials.username, password: credentials.password }),
      signal: AbortSignal.timeout(15000),
    })
  } catch {
    throw new AndreaniError('No se pudo conectar con la autenticación de Andreani.')
  }
  const payload = await readJson(response)
  if (!response.ok) throw new AndreaniError(`Andreani rechazó la autenticación (HTTP ${response.status}). Verificá las credenciales y el ambiente.`, response.status === 401 || response.status === 403 ? 400 : 502)
  const token = typeof payload?.token === 'string' ? payload.token : typeof payload?.access_token === 'string' ? payload.access_token : null
  if (!token) throw new AndreaniError('Andreani autenticó la solicitud, pero no devolvió un token reconocido.')
  cachedToken = { key, token, expiresAt: Date.now() + 23 * 60 * 60 * 1000 }
  return cachedToken.token
}

export async function testAndreaniConnection(credentialsOverride?: AndreaniCredentials) {
  const credentials = credentialsOverride ?? await getStoredAndreaniCredentials()
  if (!credentials) throw new AndreaniError('Andreani todavía no está configurado. Cargá usuario, contraseña, código de cliente y contrato en Administración > Envíos.', 503)
  await login(credentials)
  return { connected: true, environment: credentials.environment }
}

export async function quoteAndreani(input: {
  postalCode: string
  weightGrams: number
  volumeCm3: number
}) {
  const credentials = await getStoredAndreaniCredentials()
  if (!credentials) throw new AndreaniError('Andreani todavía no está configurado. Cargá usuario, contraseña, código de cliente y contrato en Administración > Envíos.', 503)

  // El cotizador estándar documenta CP destino, contrato, cliente y un bulto.
  // La cuenta define el contrato y la cobertura; no se inventa una modalidad.
  const url = new URL(`${baseUrls[credentials.environment]}/v1/tarifas`)
  url.search = new URLSearchParams({
    cpDestino: input.postalCode,
    contrato: credentials.contract,
    cliente: credentials.clientCode,
    'bultos[0][volumen]': String(Math.max(1, Math.ceil(input.volumeCm3))),
    'bultos[0][kilos]': (input.weightGrams / 1000).toFixed(3),
  }).toString()

  let response: Response
  try {
    response = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(20000) })
  } catch {
    throw new AndreaniError('No se pudo conectar con el cotizador de Andreani.')
  }
  const payload = await readJson(response)
  if (!response.ok) throw new AndreaniError(`Andreani respondió HTTP ${response.status} al cotizar. Revisá contrato, cliente y cobertura.`)
  const totalWithTax = Number(payload?.tarifaConIva?.total)
  const totalWithoutTax = Number(payload?.tarifaSinIva?.total)
  const amount = Number.isFinite(totalWithTax) && totalWithTax >= 0 ? totalWithTax : totalWithoutTax
  if (!Number.isFinite(amount) || amount < 0) throw new AndreaniError('Andreani respondió, pero no se encontró una tarifa válida en la respuesta.')
  return {
    key: 'andreani-standard',
    carrierName: 'Andreani',
    carrierId: null,
    serviceCode: credentials.contract,
    serviceLabel: 'Andreani · Envío a domicilio',
    priceArs: Math.round(amount),
    estimatedHours: null,
  }
}
