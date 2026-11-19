export class OcaAdmissionXmlError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'OcaAdmissionXmlError'
  }
}

type OcaAddress = {
  street: string
  number: string
  floor?: string
  department?: string
  postalCode: string
  locality: string
  province: string
}

export type OcaAdmissionXmlInput = {
  accountNumber: string
  operative: string
  orderReference: string
  admissionDate: string
  timeWindowId?: 1 | 2 | 3
  costCenter: string
  originBranchId: string
  origin: OcaAddress & {
    contact?: string
    email?: string
    applicant?: string
    observations?: string
  }
  recipient: OcaAddress & {
    firstName: string
    lastName: string
    phone?: string
    email?: string
    destinationBranchId?: string
    mobile?: string
    observations?: string
  }
  parcel: {
    heightCm: number
    widthCm: number
    lengthCm: number
    weightKg: number
  }
  insuranceEnabled?: boolean
  declaredValueArs?: number
}

function text(value: string | undefined, field: string, maxLength: number, required = false): string {
  const normalized = value?.trim() || ''
  if (required && !normalized) throw new OcaAdmissionXmlError('Falta completar ' + field + '.')
  if (normalized.length > maxLength) throw new OcaAdmissionXmlError(field + ' supera el máximo de ' + maxLength + ' caracteres.')
  if (/[|&<>]/.test(normalized)) throw new OcaAdmissionXmlError(field + ' contiene un carácter que OCA no admite en el XML (|, &, < o >).')
  return normalized
}

function attr(name: string, value: string | number | undefined): string {
  if (value === undefined || value === '') return ''
  const escaped = String(value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  return ' ' + name + '="' + escaped + '"'
}

function numericIdentifier(value: string, field: string, maxLength: number): string {
  const normalized = text(value, field, maxLength, true)
  if (!/^\d+$/.test(normalized)) throw new OcaAdmissionXmlError(field + ' debe contener solo dígitos.')
  return normalized
}

function addressAttributes(address: OcaAddress) {
  return [
    attr('calle', text(address.street, 'la calle', 30, true)),
    attr('nro', text(address.number, 'la altura', 5, true)),
    attr('piso', text(address.floor, 'el piso', 6)),
    attr('depto', text(address.department, 'el departamento', 4)),
    attr('cp', text(address.postalCode, 'el código postal', 4, true)),
    attr('localidad', text(address.locality, 'la localidad', 30, true)),
    attr('provincia', text(address.province, 'la provincia', 30, true)),
  ].join('')
}

function decimal(value: number, field: string): string {
  if (!Number.isFinite(value) || value <= 0) throw new OcaAdmissionXmlError('El valor de ' + field + ' debe ser mayor que cero.')
  return value.toFixed(2)
}

export function buildOcaAdmissionXml(input: OcaAdmissionXmlInput): string {
  const accountNumber = text(input.accountNumber, 'el número de cuenta OCA', 10, true)
  const operative = numericIdentifier(input.operative, 'la operativa OCA', 6)
  const orderReference = text(input.orderReference, 'el número de remito', 30, true)
  const costCenter = numericIdentifier(input.costCenter, 'el centro de costo', 10)
  const originBranchId = numericIdentifier(input.originBranchId, 'la sucursal OCA de admisión', 3)

  if (!/^\d{8}$/.test(input.admissionDate)) {
    throw new OcaAdmissionXmlError('La fecha de admisión debe tener formato AAAAMMDD.')
  }
  const year = Number(input.admissionDate.slice(0, 4))
  const month = Number(input.admissionDate.slice(4, 6))
  const day = Number(input.admissionDate.slice(6, 8))
  const parsedDate = new Date(Date.UTC(year, month - 1, day))
  if (parsedDate.getUTCFullYear() !== year || parsedDate.getUTCMonth() !== month - 1 || parsedDate.getUTCDate() !== day) {
    throw new OcaAdmissionXmlError('La fecha de admisión no es una fecha válida.')
  }
  if (input.timeWindowId !== undefined && ![1, 2, 3].includes(input.timeWindowId)) {
    throw new OcaAdmissionXmlError('La franja horaria OCA debe ser 1, 2 o 3.')
  }
  if (!/^\d{4}$/.test(input.origin.postalCode) || !/^\d{4}$/.test(input.recipient.postalCode)) {
    throw new OcaAdmissionXmlError('Los códigos postales de origen y destino deben tener cuatro dígitos.')
  }

  const originAttributes = [
    addressAttributes(input.origin),
    attr('contacto', text(input.origin.contact, 'el contacto de origen', 30)),
    attr('email', text(input.origin.email, 'el email de origen', 100)),
    attr('solicitante', text(input.origin.applicant, 'el solicitante', 30)),
    attr('observaciones', text(input.origin.observations, 'las observaciones de origen', 100)),
    attr('centrocosto', costCenter),
    ...(input.timeWindowId === undefined ? [] : [attr('idfranjahoraria', input.timeWindowId)]),
    attr('idcentroimposicionorigen', originBranchId),
    attr('fecha', input.admissionDate),
  ].join('')

  const recipient = input.recipient
  const recipientAttributes = [
    attr('apellido', text(recipient.lastName, 'el apellido del destinatario', 30, true)),
    attr('nombre', text(recipient.firstName, 'el nombre del destinatario', 30, true)),
    addressAttributes(recipient),
    attr('telefono', text(recipient.phone, 'el teléfono', 30)),
    attr('email', text(recipient.email, 'el email del destinatario', 100)),
    attr('idci', recipient.destinationBranchId ? numericIdentifier(recipient.destinationBranchId, 'la sucursal OCA de destino', 3) : ''),
    attr('celular', text(recipient.mobile, 'el celular', 15)),
    attr('observaciones', text(recipient.observations, 'las observaciones del destinatario', 100)),
  ].join('')

  const insuranceEnabled = input.insuranceEnabled === true
  const declaredValue = insuranceEnabled ? input.declaredValueArs : 0
  if (insuranceEnabled && (!Number.isSafeInteger(declaredValue) || (declaredValue || 0) <= 0)) {
    throw new OcaAdmissionXmlError('Para asegurar el envío, indicá un valor declarado entero mayor que cero.')
  }

  const parcelAttributes = [
    attr('alto', decimal(input.parcel.heightCm, 'alto del paquete')),
    attr('ancho', decimal(input.parcel.widthCm, 'ancho del paquete')),
    attr('largo', decimal(input.parcel.lengthCm, 'largo del paquete')),
    attr('peso', decimal(input.parcel.weightKg, 'peso del paquete')),
    attr('valor', (declaredValue || 0).toFixed(2)),
    attr('cant', 1),
  ].join('')

  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<ROWS><cabecera ver="2.0"' + attr('nrocuenta', accountNumber) + ' origen="API" />'
    + '<origenes><origen' + originAttributes + '><envios><envio'
    + attr('idoperativa', operative) + attr('nroremito', orderReference) + '>'
    + '<destinatario' + recipientAttributes + ' />'
    + '<paquetes><paquete' + parcelAttributes + ' /></paquetes>'
    + '</envio></envios></origen></origenes></ROWS>'
}
