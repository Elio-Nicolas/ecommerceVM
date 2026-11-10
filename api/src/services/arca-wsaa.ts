import { execFile as execFileCallback } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, readFile, rm, writeFile, chmod } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { env } from '../config/env'

const execFile = promisify(execFileCallback)

export type ArcaEnvironment = 'HOMOLOGATION' | 'PRODUCTION'

export interface ArcaAccessTicket {
  token: string
  sign: string
  expiresAt: Date
}

const ticketCache = new Map<string, ArcaAccessTicket>()
const ticketRequests = new Map<string, Promise<ArcaAccessTicket>>()
const ticketRetryAfter = new Map<string, number>()
const WSAA_RETRY_COOLDOWN_MS = 60_000

const WSAA_URLS: Record<ArcaEnvironment, string> = {
  HOMOLOGATION: 'https://wsaahomo.afip.gov.ar/ws/services/LoginCms',
  PRODUCTION: 'https://wsaa.afip.gov.ar/ws/services/LoginCms',
}

function requiredConfig() {
  const cuit = env.ARCA_CUIT
  const certificatePath = env.ARCA_CERTIFICATE_PATH
  const privateKeyPath = env.ARCA_PRIVATE_KEY_PATH

  if (!cuit || !certificatePath || !privateKeyPath) {
    throw new Error('ARCA no está configurado: faltan ARCA_CUIT, ARCA_CERTIFICATE_PATH o ARCA_PRIVATE_KEY_PATH')
  }

  return { cuit, certificatePath, privateKeyPath }
}

function localArcaDate(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date)
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}:${values.second}`
}

function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
}

function decodeXml(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

function readTag(xml: string, tag: string): string | null {
  const match = xml.match(new RegExp(`<(?:[\\w.-]+:)?${tag}\\b[^>]*>([\\s\\S]*?)<\\/(?:[\\w.-]+:)?${tag}\\s*>`, 'i'))
  return match ? decodeXml(match[1].trim()) : null
}

function createTra(): string {
  const now = new Date()
  const generationTime = new Date(now.getTime() - 10 * 60 * 1000)
  const expirationTime = new Date(now.getTime() + 10 * 60 * 1000)
  const uniqueId = Math.floor(now.getTime() / 1000)

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<loginTicketRequest version="1.0">',
    '<header>',
    `<uniqueId>${uniqueId}</uniqueId>`,
    `<generationTime>${localArcaDate(generationTime)}</generationTime>`,
    `<expirationTime>${localArcaDate(expirationTime)}</expirationTime>`,
    '</header>',
    '<service>wsfe</service>',
    '</loginTicketRequest>',
  ].join('')
}

async function signTra(cmsInput: string): Promise<string> {
  const { certificatePath, privateKeyPath } = requiredConfig()
  const directory = await mkdtemp(join(tmpdir(), 'ecommercevm-arca-'))
  const traPath = join(directory, 'login-ticket-request.xml')
  const cmsPath = join(directory, 'login-ticket-request.cms')

  try {
    await chmod(directory, 0o700)
    await writeFile(traPath, cmsInput, { encoding: 'utf8', mode: 0o600 })
    await execFile(env.ARCA_OPENSSL_PATH, [
      'cms', '-sign', '-binary', '-md', 'sha1',
      '-in', traPath,
      '-signer', certificatePath,
      '-inkey', privateKeyPath,
      '-outform', 'DER',
      '-out', cmsPath,
      '-nodetach',
    ], { timeout: 15_000, maxBuffer: 1024 * 1024 })

    return (await readFile(cmsPath)).toString('base64')
  } catch {
    throw new Error('No se pudo firmar el ticket de acceso ARCA. Verificá el certificado, la clave privada y OpenSSL.')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

async function requestTicket(environment: ArcaEnvironment): Promise<ArcaAccessTicket> {
  requiredConfig()
  const cms = await signTra(createTra())
  const envelope = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:wsaa="http://wsaa.view.sua.dvadac.desein.afip.gov">',
    '<soapenv:Header/>',
    '<soapenv:Body>',
    '<wsaa:loginCms><wsaa:in0>' + escapeXml(cms) + '</wsaa:in0></wsaa:loginCms>',
    '</soapenv:Body>',
    '</soapenv:Envelope>',
  ].join('')

  const response = await fetch(WSAA_URLS[environment], {
    method: 'POST',
    headers: { 'content-type': 'text/xml; charset=utf-8', SOAPAction: '""' },
    body: envelope,
    signal: AbortSignal.timeout(20_000),
  })
  const responseXml = await response.text()

  // SOAP 1.1 faults commonly arrive with HTTP 500. Inspect the SOAP body
  // first so authorization faults (for example coe.notAuthorized) are not
  // hidden behind the generic HTTP status.
  const fault = readTag(responseXml, 'faultstring')
  const faultCode = readTag(responseXml, 'faultcode')
  if (fault) throw new Error(`WSAA rechazó la autenticación: ${faultCode ? `${faultCode}: ` : ''}${fault}`)

  if (!response.ok) {
    throw new Error(`WSAA respondió HTTP ${response.status}`)
  }

  const ticketXml = readTag(responseXml, 'loginCmsReturn')
  if (!ticketXml) throw new Error('WSAA devolvió una respuesta sin loginCmsReturn')

  const token = readTag(ticketXml, 'token')
  const sign = readTag(ticketXml, 'sign')
  const expiration = readTag(ticketXml, 'expirationTime')

  if (!token || !sign || !expiration) {
    throw new Error('WSAA devolvió un ticket incompleto')
  }

  const expiresAt = new Date(/(?:Z|[+-][0-9]{2}:?[0-9]{2})$/i.test(expiration) ? expiration : `${expiration}-03:00`)
  if (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() <= Date.now()) {
    throw new Error('WSAA devolvió un ticket vencido o con fecha inválida')
  }

  return { token, sign, expiresAt }
}

function assertRetryAllowed(cacheKey: string): void {
  const retryAt = ticketRetryAfter.get(cacheKey)
  if (retryAt === undefined) return

  if (retryAt === Number.POSITIVE_INFINITY) {
    throw new Error('WSAA devolvió un error permanente. Corregí la causa indicada por ARCA y reiniciá la API para volver a intentar.')
  }

  if (retryAt > Date.now()) {
    throw new Error('WSAA rechazó o no pudo procesar la autenticación recientemente. Esperá al menos 60 segundos antes de reintentar.')
  }

  ticketRetryAfter.delete(cacheKey)
}

function requestAndCacheTicket(environment: ArcaEnvironment, cacheKey: string): Promise<ArcaAccessTicket> {
  return requestTicket(environment)
    .then((ticket) => {
      ticketCache.set(cacheKey, ticket)
      ticketRetryAfter.delete(cacheKey)
      return ticket
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : ''
      const faultCodeMatch = message.match(/WSAA rechazó la autenticación: ([^:]+):/)
      const qualifiedFaultCode = faultCodeMatch?.[1]?.trim() ?? ''
      const faultCode = qualifiedFaultCode.split(':').pop()?.toLowerCase() ?? ''
      const retryableFault = faultCode.startsWith('wsaa.') || faultCode === 'wsn.unavailable'
      const alreadyAuthenticated = faultCode === 'coe.alreadyauthenticated'
      const retryAt = alreadyAuthenticated
        ? Date.now() + 12 * 60 * 60 * 1000
        : retryableFault || !faultCode
          ? Date.now() + WSAA_RETRY_COOLDOWN_MS
          : Number.POSITIVE_INFINITY

      ticketRetryAfter.set(cacheKey, retryAt)
      throw error
    })
}

export async function getArcaAccessTicket(environment: ArcaEnvironment): Promise<ArcaAccessTicket> {
  const { cuit } = requiredConfig()
  const cacheKey = environment + ':wsfe:' + cuit
  const cached = ticketCache.get(cacheKey)
  const now = Date.now()

  if (cached && cached.expiresAt.getTime() > now) {
    // Keep serving a valid ticket immediately; refresh it in the background
    // once it enters the five-minute renewal window.
    if (cached.expiresAt.getTime() - now <= 5 * 60 * 1000 && !ticketRequests.has(cacheKey)) {
      try {
        assertRetryAllowed(cacheKey)
      } catch {
        return cached
      }
      const refresh = requestAndCacheTicket(environment, cacheKey)
        .catch((error: unknown) => {
          // Never hand out a ticket that expired while the refresh was running.
          if (cached.expiresAt.getTime() > Date.now()) return cached
          throw error
        })
        .finally(() => ticketRequests.delete(cacheKey))

      // The first caller already received the still-valid cached ticket.
      // Handle a background rejection to avoid an unhandledRejection; callers
      // that join ticketRequests still receive the original promise and error.
      void refresh.catch(() => undefined)
      ticketRequests.set(cacheKey, refresh)
    }

    return cached
  }

  const pending = ticketRequests.get(cacheKey)
  if (pending) return pending

  assertRetryAllowed(cacheKey)
  const request = requestAndCacheTicket(environment, cacheKey)
    .finally(() => ticketRequests.delete(cacheKey))

  ticketRequests.set(cacheKey, request)
  return request
}
