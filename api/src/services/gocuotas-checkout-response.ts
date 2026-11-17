export type GoCuotasCheckoutPayload = {
  id?: number | string
  url_init?: string
}

export type GoCuotasCheckoutResponse = {
  payload: GoCuotasCheckoutPayload | null
  diagnostic: string
}

function describeBody(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  return typeof value
}

/**
 * Reads a checkout response without persisting or logging its values.
 * Diagnostics intentionally contain only response metadata and top-level keys.
 */
export async function readGoCuotasCheckoutResponse(response: Response): Promise<GoCuotasCheckoutResponse> {
  const contentType = (response.headers.get('content-type') || 'unknown').split(';', 1)[0].slice(0, 80)
  const bodyText = await response.text()
  let parsed: unknown = null
  let parsedJson = false

  if (bodyText.length > 0) {
    try {
      parsed = JSON.parse(bodyText)
      parsedJson = true
    } catch {
      parsedJson = false
    }
  }

  const isRecord = parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
  const keys = isRecord ? Object.keys(parsed as Record<string, unknown>).slice(0, 20).sort() : []
  const record = isRecord ? parsed as Record<string, unknown> : null
  const id = record?.id
  const urlInit = record?.url_init
  const payload = isRecord ? record as GoCuotasCheckoutPayload : null

  return {
    payload,
    diagnostic: [
      'HTTP ' + response.status,
      'content-type=' + contentType,
      'body=' + (bodyText.length === 0 ? 'empty' : parsedJson ? describeBody(parsed) : 'non-json'),
      'keys=' + (keys.length > 0 ? keys.join(',') : 'none'),
      'id=' + (id === undefined || id === null ? 'missing' : typeof id),
      'url_init=' + (typeof urlInit === 'string' ? 'string' : urlInit === undefined || urlInit === null ? 'missing' : typeof urlInit),
    ].join('; ')
  }
}
