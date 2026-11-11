export interface ArcaVoucherLookup {
  outcome: 'AUTHORIZED' | 'NOT_FOUND' | 'UNKNOWN'
  cae: string | null
  caeExpiresAt: Date | null
  responsePayload: Record<string, unknown>
  message: string
}

export interface ArcaVoucherIdentity {
  pointOfSale: number
  voucherType: number
  voucherNumber: number
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
  const match = xml.match(new RegExp(\`<(?:[\\\\w.-]+:)?\${tag}\\\\b[^>]*>([\\\\s\\\\S]*?)<\\\\/(?:[\\\\w.-]+:)?\${tag}\\\\s*>\`, 'i'))
  return match ? decodeXml(match[1].trim()) : null
}

function readBlocks(xml: string, tag: string): string[] {
  const matches = xml.matchAll(new RegExp(\`<(?:[\\\\w.-]+:)?\${tag}\\\\b[^>]*>([\\\\s\\\\S]*?)<\\\\/(?:[\\\\w.-]+:)?\${tag}\\\\s*>\`, 'gi'))
  return Array.from(matches, (match) => match[1])
}

function parseArcaDate(value: string | null): Date | null {
  if (!value || !/^\\d{8}$/.test(value)) return null
  const year = Number(value.slice(0, 4))
  const month = Number(value.slice(4, 6))
  const day = Number(value.slice(6, 8))
  const date = new Date(\`\${value.slice(0, 4)}-\${value.slice(4, 6)}-\${value.slice(6, 8)}T00:00:00-03:00\`)
  if (Number.isNaN(date.getTime()) || date.getUTCFullYear() !== year ||
    date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day) return null
  return date
}

export function parseArcaVoucherConsultResponse(
  responseXml: string,
  httpStatus: number,
  expected: ArcaVoucherIdentity,
): ArcaVoucherLookup {
  const fault = readTag(responseXml, 'faultstring')
  if (fault) throw new Error(\`ARCA devolvió un error SOAP: \${fault}\`)
  if (httpStatus < 200 || httpStatus >= 300) {
    throw new Error(\`ARCA respondió HTTP \${httpStatus} al consultar el comprobante.\`)
  }

  const result = readTag(responseXml, 'FECompConsultarResult')
  if (!result) throw new Error('ARCA devolvió una respuesta incompleta al consultar el comprobante.')

  const errors = readBlocks(result, 'Err').map((block) => ({
    code: readTag(block, 'Code'),
    message: readTag(block, 'Msg'),
  }))
  const resultGet = readTag(result, 'ResultGet')
  if (!resultGet && errors.length === 1 && errors[0].code === '602') {
    return {
      outcome: 'NOT_FOUND',
      cae: null,
      caeExpiresAt: null,
      responsePayload: { errors },
      message: 'ARCA confirmó que no existe un comprobante con ese punto de venta, tipo y número.',
    }
  }
  if (errors.length) {
    throw new Error(\`ARCA no pudo confirmar el comprobante: \${errors.map((error) => [error.code, error.message].filter(Boolean).join(' ')).join('; ')}\`)
  }
  if (!resultGet) throw new Error('ARCA no devolvió datos del comprobante; el resultado sigue siendo ambiguo.')

  const outcome = readTag(resultGet, 'Resultado')
  const cae = readTag(resultGet, 'CodAutorizacion') ?? readTag(resultGet, 'CAE')
  const caeExpiresAt = parseArcaDate(readTag(resultGet, 'FchVto') ?? readTag(resultGet, 'CAEFchVto'))
  const voucherType = readTag(resultGet, 'CbteTipo')
  const pointOfSale = readTag(resultGet, 'PtoVta')
  const voucherNumber = readTag(resultGet, 'CbteDesde')
  const responsePayload = {
    outcome,
    cae,
    caeExpiresAt: caeExpiresAt?.toISOString() ?? null,
    voucherDate: readTag(resultGet, 'CbteFch'),
    voucherType,
    pointOfSale,
    voucherNumber,
  }

  if (outcome !== 'A' || pointOfSale !== String(expected.pointOfSale) ||
    voucherType !== String(expected.voucherType) || voucherNumber !== String(expected.voucherNumber)) {
    throw new Error('ARCA devolvió un comprobante distinto del solicitado o sin autorización verificable.')
  }
  if (!cae || !/^\\d{14}$/.test(cae) || !caeExpiresAt) {
    throw new Error('ARCA devolvió el comprobante sin un CAE y vencimiento verificables.')
  }

  return {
    outcome: 'AUTHORIZED',
    cae,
    caeExpiresAt,
    responsePayload,
    message: 'ARCA confirmó que el comprobante está autorizado. Se recuperó el CAE.',
  }
}
