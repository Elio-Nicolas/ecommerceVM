export type NaranjaXHttpMethod = 'GET' | 'POST'

export interface NaranjaXHttpRequest {
  method: NaranjaXHttpMethod
  path: string
  headers?: Record<string, string>
  body?: unknown
}

export class NaranjaXHttpError extends Error {
  constructor(
    public readonly code: 'INVALID_CONFIGURATION' | 'INVALID_PATH' | 'TIMEOUT' | 'NETWORK_ERROR' | 'HTTP_ERROR' | 'INVALID_JSON',
    message: string,
    public readonly status?: number,
  ) {
    super(message)
    this.name = 'NaranjaXHttpError'
  }
}

export interface NaranjaXHttpClientOptions {
  baseUrl: string
  timeoutMs?: number
  fetchImpl?: typeof fetch
}

/**
 * Provider-isolated JSON transport. It deliberately knows nothing about
 * Naranja X authentication, endpoint paths, or payload schemas: those must
 * come from the merchant's confirmed integration contract.
 */
export class NaranjaXHttpClient {
  private readonly baseUrl: URL
  private readonly timeoutMs: number
  private readonly fetchImpl: typeof fetch

  constructor(options: NaranjaXHttpClientOptions) {
    let parsed: URL
    try {
      parsed = new URL(options.baseUrl)
    } catch {
      throw new NaranjaXHttpError('INVALID_CONFIGURATION', 'La URL base de Naranja X no es válida.')
    }
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash) {
      throw new NaranjaXHttpError('INVALID_CONFIGURATION', 'La URL base de Naranja X debe ser HTTPS y no incluir credenciales, query ni fragmento.')
    }

    const timeoutMs = options.timeoutMs ?? 10_000
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 60_000) {
      throw new NaranjaXHttpError('INVALID_CONFIGURATION', 'El timeout HTTP debe estar entre 100 y 60000 milisegundos.')
    }

    this.baseUrl = parsed
    this.timeoutMs = timeoutMs
    this.fetchImpl = options.fetchImpl ?? fetch
  }

  async request<T>(request: NaranjaXHttpRequest): Promise<T> {
    if (!request.path.startsWith('/') || request.path.startsWith('//') || request.path.includes('\\')) {
      throw new NaranjaXHttpError('INVALID_PATH', 'La ruta HTTP debe ser relativa al host configurado.')
    }

    const url = new URL(request.path, this.baseUrl)
    if (url.origin !== this.baseUrl.origin) {
      throw new NaranjaXHttpError('INVALID_PATH', 'La ruta HTTP no puede cambiar el host configurado.')
    }

    const headers = new Headers({ accept: 'application/json' })
    for (const [name, value] of Object.entries(request.headers ?? {})) {
      headers.set(name, value)
    }

    let body: string | undefined
    if (request.body !== undefined) {
      body = JSON.stringify(request.body)
      if (body === undefined) {
        throw new NaranjaXHttpError('INVALID_CONFIGURATION', 'El cuerpo HTTP no se pudo serializar como JSON.')
      }
      if (!headers.has('content-type')) headers.set('content-type', 'application/json')
    }

    let response: Response
    try {
      response = await this.fetchImpl(url, {
        method: request.method,
        headers,
        body,
        signal: AbortSignal.timeout(this.timeoutMs),
        redirect: 'error',
      })
    } catch (error) {
      if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
        throw new NaranjaXHttpError('TIMEOUT', 'La solicitud a Naranja X superó el tiempo máximo de espera.')
      }
      throw new NaranjaXHttpError('NETWORK_ERROR', 'No se pudo establecer comunicación con el servicio de Naranja X.')
    }

    if (!response.ok) {
      throw new NaranjaXHttpError('HTTP_ERROR', 'Naranja X respondió con un error HTTP.', response.status)
    }

    const responseText = await response.text()
    if (!responseText.trim()) return undefined as T

    try {
      return JSON.parse(responseText) as T
    } catch {
      throw new NaranjaXHttpError('INVALID_JSON', 'Naranja X devolvió una respuesta que no es JSON válido.', response.status)
    }
  }
}
