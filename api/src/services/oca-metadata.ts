import { getShippingSettings, getStoredOcaCredentials } from './shipping-settings'

export class OcaMetadataError extends Error {
  constructor(message: string, readonly statusCode = 502) {
    super(message)
    this.name = 'OcaMetadataError'
  }
}

const costCenterQaEndpoint = 'https://integraciones.ocadev.com.ar/epak_tracking_test/GetCentroCostoPorOperativa'

function decodeXml(value: string): string {
  let decoded = value
  for (let index = 0; index < 2; index += 1) {
    decoded = decoded.replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"').replace(/&apos;/gi, "'").replace(/&amp;/gi, '&')
  }
  return decoded
}

function readTag(xml: string, name: string): string | null {
  const match = xml.match(new RegExp('<(?:[\\w.-]+:)?' + name + '(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:[\\w.-]+:)?' + name + '\\s*>', 'i'))
  return match?.[1] ? match[1].replace(/<[^>]+>/g, '').trim() : null
}

function parseRows(xml: string): string[] {
  const decoded = decodeXml(xml)
  const rows = [...decoded.matchAll(/<(?:[\w.-]+:)?Table(?:\s[^>]*)?>([\s\S]*?)<\/(?:[\w.-]+:)?Table\s*>/gi)]
  if (rows.length) return rows.map((row) => row[1])
  if (/<(?:[\w.-]+:)?NewDataSet\b/i.test(decoded)) return []
  throw new OcaMetadataError('OCA devolvió un XML de centros de costo con una estructura no reconocida.')
}

export type OcaCostCenter = {
  number: string
  requester: string | null
  locality: string | null
  postalCode: string | null
}

export function parseOcaCostCenters(xml: string): OcaCostCenter[] {
  const decoded = decodeXml(xml)
  if (!decoded.trim() || /<(?:[\w.-]+:)?Fault\b/i.test(decoded)) {
    throw new OcaMetadataError('OCA devolvió una respuesta inválida al consultar centros de costo.')
  }
  return parseRows(decoded).map((row) => ({
    number: readTag(row, 'NroCentroCosto') ?? '',
    requester: readTag(row, 'Solicitante'),
    locality: readTag(row, 'LocalidadRetiro'),
    postalCode: readTag(row, 'codigopostal') ?? readTag(row, 'CodigoPostal'),
  })).filter((center) => /^\d{1,10}$/.test(center.number))
}

export async function getOcaCostCenters(): Promise<OcaCostCenter[]> {
  const credentials = await getStoredOcaCredentials()
  if (!credentials) throw new OcaMetadataError('Configurá primero usuario e-Pak, contraseña, CUIT y operativa OCA.', 503)
  if (credentials.environment !== 'QA') throw new OcaMetadataError('La consulta de centros de costo está habilitada sólo en QA hasta autorizar explícitamente el uso de producción.', 409)
  const url = new URL(costCenterQaEndpoint)
  url.search = new URLSearchParams({
    CUIT: credentials.cuit.slice(0, 2) + '-' + credentials.cuit.slice(2, 10) + '-' + credentials.cuit.slice(10),
    Operativa: credentials.operative,
  }).toString()

  let response: Response
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(15000) })
  } catch {
    throw new OcaMetadataError('No se pudo conectar con OCA para consultar los centros de costo.')
  }
  if (!response.ok) throw new OcaMetadataError('OCA respondió HTTP ' + response.status + ' al consultar centros de costo.')
  const centers = parseOcaCostCenters(await response.text())
  if (!centers.length) throw new OcaMetadataError('OCA no devolvió centros de costo para la CUIT y operativa configuradas.')
  return centers
}


export type OcaAdmissionBranch = {
  id: string
  code: string | null
  name: string
  address: string | null
  postalCode: string | null
  locality: string | null
  province: string | null
  admissionEnabled: true
}

export function parseOcaAdmissionBranches(xml: string): OcaAdmissionBranch[] {
  const decoded = decodeXml(xml)
  if (!decoded.trim() || /<(?:[\w.-]+:)?Fault\b/i.test(decoded)) {
    throw new OcaMetadataError('OCA devolvió una respuesta inválida al consultar sucursales.')
  }
  const centerRows = [...decoded.matchAll(/<(?:[\w.-]+:)?Centro(?:\s[^>]*)?>([\s\S]*?)<\/(?:[\w.-]+:)?Centro\s*>/gi)]
  if (!centerRows.length && !/<(?:[\w.-]+:)?CentrosDeImposicion\b/i.test(decoded)) {
    throw new OcaMetadataError('OCA devolvió un XML de sucursales con una estructura no reconocida.')
  }

  return centerRows.flatMap((match) => {
    const row = match[1]
    const services = [...row.matchAll(/<(?:[\w.-]+:)?Servicio(?:\s[^>]*)?>([\s\S]*?)<\/(?:[\w.-]+:)?Servicio\s*>/gi)]
    const hasAdmission = services.some((service) => {
      const id = readTag(service[1], 'IdTipoServicio')
      const description = readTag(service[1], 'ServicioDesc')?.toLocaleLowerCase('es')
      return id === '1' || description?.includes('admisión de paquetes') === true
    })
    if (!hasAdmission) return []
    const id = readTag(row, 'IdCentroImposicion')
    if (!id || !/^\d{1,3}$/.test(id)) return []
    const street = readTag(row, 'Calle')
    const number = readTag(row, 'Numero')
    const address = [street, number].filter((part) => part && part.trim()).join(' ').trim()
    return [{
      id,
      code: readTag(row, 'Sigla'),
      name: readTag(row, 'Sucursal')?.trim() || readTag(row, 'Descripcion')?.trim() || 'Sucursal OCA',
      address: address || null,
      postalCode: readTag(row, 'CodigoPostal')?.trim() || null,
      locality: readTag(row, 'Localidad')?.trim() || null,
      province: readTag(row, 'Provincia')?.trim() || null,
      admissionEnabled: true as const,
    }]
  })
}

export async function getOcaAdmissionBranches(postalCode: string): Promise<OcaAdmissionBranch[]> {
  if (!/^\d{4}$/.test(postalCode)) throw new OcaMetadataError('El código postal debe tener cuatro dígitos.', 400)
  const settings = await getShippingSettings()
  const environment = settings.ocaEnvironment as 'QA' | 'PRODUCTION'
  if (environment !== 'QA') throw new OcaMetadataError('La consulta de sucursales está habilitada sólo en QA hasta autorizar explícitamente el uso de producción.', 409)
  const base = 'https://integraciones.ocadev.com.ar/epak_tracking_test/Oep_TrackEPak.asmx/GetCentrosImposicionConServiciosByCP'
  const url = new URL(base)
  url.search = new URLSearchParams({ CodigoPostal: postalCode }).toString()

  let response: Response
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(15000) })
  } catch {
    throw new OcaMetadataError('No se pudo conectar con OCA para consultar sucursales.')
  }
  if (!response.ok) throw new OcaMetadataError('OCA respondió HTTP ' + response.status + ' al consultar sucursales.')
  const branches = parseOcaAdmissionBranches(await response.text())
  return branches
}
