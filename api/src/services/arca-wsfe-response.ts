export interface ArcaInvoiceCResult {
  outcome: 'AUTHORIZED' | 'REJECTED' | 'UNKNOWN'
  cae: string | null
  caeExpiresAt: Date | null
  responsePayload: Record<string, unknown>
  message: string
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

function readBlocks(xml: string, tag: string): string[] {
  const matches = xml.matchAll(new RegExp(`<(?:[\\w.-]+:)?${tag}\\b[^>]*>([\\s\\S]*?)<\\/(?:[\\w.-]+:)?${tag}\\s*>`, 'gi'))
  return Array.from(matches, (match) => match[1])
}

function parseArcaDate(value: string | null): Date | null {
  if (!value || !/^\\d{8}$/.test(value)) return null
  const year = Number(value.slice(0, 4))
  const month = Number(value.slice(4, 6))
  const day = Number(value.slice(6, 8))
  const date = new Date(`${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T00:00:00-03:00`)
  if (date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day) return null
  return date
}

function readMessages(xml: string, group: 'Err' | 'Obs' | 'Evt'): string[] {
  return readBlocks(xml, group).map((block) => {
    const code = readTag(block, 'Code')
    const message = readTag(block, 'Msg')
    return [code ? `[${code}]` : '', message ?? ''].filter(Boolean).join(' ')
  })
}

export function parseArcaInvoiceCResponse(responseXml: string, httpStatus: number): ArcaInvoiceCResult {
  const fault = readTag(responseXml, 'faultstring')
  if (fault) {
    return {
      outcome: 'UNKNOWN',
      cae: null,
      caeExpiresAt: null,
      responsePayload: { soapFault: fault, httpStatus },
      message: `ARCA devolvió un error SOAP y no se puede asegurar el resultado: ${fault}`,
    }
  }
  if (httpStatus < 200 || httpStatus >= 300) {
    return {
      outcome: 'UNKNOWN',
      cae: null,
      caeExpiresAt: null,
      responsePayload: { httpStatus, responseReceived: Boolean(responseXml) },
      message: `ARCA respondió HTTP ${httpStatus}; el resultado queda pendiente de conciliación.`,
    }
  }

  const result = readTag(responseXml, 'FECAESolicitarResult') ?? ''
  const header = readTag(result, 'FeCabResp') ?? ''
  const detail = readBlocks(readTag(result, 'FeDetResp') ?? '', 'FECAEDetResponse')[0] ?? ''
  const headerOutcome = readTag(header, 'Resultado')
  const detailOutcome = readTag(detail, 'Resultado')
  const cae = readTag(detail, 'CAE')
  const caeExpiresAt = parseArcaDate(readTag(detail, 'CAEFchVto'))
  const errors = readMessages(result, 'Err')
  const observations = readMessages(result, 'Obs')
  const events = readMessages(result, 'Evt')
  const responsePayload = {
    headerOutcome,
    detailOutcome,
    errors,
    observations,
    events,
    cae,
    caeExpiresAt: caeExpiresAt?.toISOString() ?? null,
  }

  if ((headerOutcome === 'A' || headerOutcome === 'P') && detailOutcome === 'A' && cae && caeExpiresAt) {
    return {
      outcome: 'AUTHORIZED',
      cae,
      caeExpiresAt,
      responsePayload,
      message: observations.length
        ? `Factura C autorizada con observaciones: ${observations.join('; ')}`
        : 'Factura C autorizada por ARCA.',
    }
  }

  if (headerOutcome === 'R' || detailOutcome === 'R') {
    return {
      outcome: 'REJECTED',
      cae: null,
      caeExpiresAt: null,
      responsePayload,
      message: errors.length ? `ARCA rechazó la factura: ${errors.join('; ')}` : 'ARCA rechazó la factura.',
    }
  }

  return {
    outcome: 'UNKNOWN',
    cae: null,
    caeExpiresAt: null,
    responsePayload,
    message: 'ARCA respondió sin una autorización o rechazo concluyente. No vuelvas a emitir hasta conciliar el comprobante.',
  }
}
