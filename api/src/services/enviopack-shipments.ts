import { prisma } from '../lib/prisma'
import { getEnviopackCredentials } from './shipping-settings'

export class EnviopackShipmentError extends Error {
  constructor(message: string, readonly statusCode?: number) {
    super(message)
    this.name = 'EnviopackShipmentError'
  }
}

type EnviopackResponse = {
  id?: string | number
  estado?: string
  tracking_number?: string | null
  pedido?: string | number
  [key: string]: unknown
}

async function requestEnviopack<T>(path: string, init?: RequestInit): Promise<T> {
  const credentials = await getEnviopackCredentials()
  if (!credentials) throw new EnviopackShipmentError('Envíopack todavía no tiene credenciales configuradas.')
  const body = new URLSearchParams({
    'api-key': credentials.apiKey,
    'secret-key': credentials.secretKey,
  })
  const authResponse = await fetch('https://api.enviopack.com/auth', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(15000),
  })
  if (!authResponse.ok) throw new EnviopackShipmentError('Envíopack no pudo autenticar la cuenta. Revisá las credenciales.')
  const auth = await authResponse.json() as { access_token?: string }
  if (!auth.access_token) throw new EnviopackShipmentError('Envíopack devolvió un token inválido.')

  const separator = path.includes('?') ? '&' : '?'
  const response = await fetch(`https://api.enviopack.com${path}${separator}access_token=${encodeURIComponent(auth.access_token)}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers || {}) },
    signal: AbortSignal.timeout(25000),
  })
  if (!response.ok) {
    const message = await response.text().catch(() => '')
    throw new EnviopackShipmentError(message.slice(0, 500) || `Envíopack respondió HTTP ${response.status}.`, response.status)
  }
  return response.json() as Promise<T>
}

function splitCustomerName(fullName: string) {
  const parts = fullName.trim().split(/\s+/)
  const first = parts.shift() || 'Cliente'
  return {
    nombre: first.slice(0, 30),
    apellido: (parts.join(' ') || 'Cliente').slice(0, 30),
  }
}

function splitStreet(addressLine: string) {
  const match = addressLine.trim().match(/^(.+?)\s+(\d{1,5}[A-Za-z]?)(?:\s*[,;].*|\s+.*)?$/)
  if (!match) throw new EnviopackShipmentError('La dirección del pedido debe incluir calle y altura para generar la etiqueta. Corregí el domicilio antes de continuar.')
  return { calle: match[1].slice(0, 50), numero: match[2].slice(0, 5) }
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

export type EnviopackPackageInput = { alto: number; ancho: number; largo: number; peso: number; descripcion_primera_linea?: string; descripcion_segunda_linea?: string }

export async function createEnviopackShipment(orderId: string, carrierId: string, inputPackages: EnviopackPackageInput[]) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { items: true },
  })
  if (!order) throw new EnviopackShipmentError('El pedido no existe.')
  if (order.deliveryMethod !== 'ENVIOPACK') throw new EnviopackShipmentError('Solo se pueden generar envíos Envíopack para pedidos de esa modalidad.')
  if (order.status !== 'PREPARING') throw new EnviopackShipmentError('El pedido debe estar En preparación antes de generar el envío.')
  if (!order.customerEmail) throw new EnviopackShipmentError('El pedido necesita un correo electrónico para registrarse en Envíopack.')
  if (!order.provinceCode || !order.postalCode) throw new EnviopackShipmentError('Faltan provincia o código postal en el pedido.')
  if (order.enviopackShipmentId) throw new EnviopackShipmentError('Este pedido ya tiene un envío asociado en Envíopack.')
  const origin = await prisma.shippingOrigin.findFirst({ where: { isActive: true, isDefault: true } })
  if (!origin?.enviopackAddressId) throw new EnviopackShipmentError('Configurá el ID del depósito de Envíopack en Administración > Depósitos de despacho.')
  const selected = asObject(order.shippingCostOptions)
  const sellerOptions = Array.isArray(selected.sellerOptions) ? selected.sellerOptions.map(asObject) : []
  const carrier = sellerOptions.find((option) => String(option.carrierId || '') === carrierId)
  if (!carrier) throw new EnviopackShipmentError('El transportista elegido no pertenece a la cotización guardada del pedido. Volvé a cotizar.')
  if (!['N', 'P', 'X', 'R'].includes(String(selected.serviceCode || ''))) throw new EnviopackShipmentError('La cotización no contiene un código de servicio válido.')
  if (!Array.isArray(inputPackages) || inputPackages.length < 1 || inputPackages.length > 20) {
    throw new EnviopackShipmentError('Definí entre 1 y 20 bultos para este envío.')
  }
  for (const item of inputPackages) {
    if (![item.alto, item.ancho, item.largo].every((value) => Number.isInteger(value) && value >= 1 && value <= 300)
      || !Number.isFinite(item.peso) || item.peso <= 0 || item.peso > 1000) {
      throw new EnviopackShipmentError('Cada bulto debe tener dimensiones enteras entre 1 y 300 cm y peso mayor a 0 y hasta 1000 kg.')
    }
  }
  const { calle, numero } = splitStreet(order.addressLine)
  const name = splitCustomerName(order.customerName)

  let enviopackOrderId = order.enviopackOrderId
  if (!enviopackOrderId) {
    let known: { id_pedido?: string | number } | null = null
    try {
      known = await requestEnviopack<{ id_pedido?: string | number }>('/pedidos/obtener-ids', {
        method: 'POST',
        body: JSON.stringify({ id_externo: order.code, plataforma: 'web' }),
      })
    } catch (error) {
      if (error instanceof EnviopackShipmentError && error.statusCode === 404) known = null
      else throw error
    }
    if (known?.id_pedido) enviopackOrderId = String(known.id_pedido)
    else {
      const created = await requestEnviopack<EnviopackResponse>('/pedidos', {
        method: 'POST',
        body: JSON.stringify({
          id_externo: order.code,
          ...name,
          email: order.customerEmail,
          telefono: order.customerPhone,
          monto: order.subtotalArs,
          fecha_alta: order.createdAt.toISOString().slice(0, 19).replace('T', ' '),
          pagado: false,
          provincia: order.provinceCode,
          localidad: order.city.slice(0, 50),
        }),
      })
      if (!created.id) throw new EnviopackShipmentError('Envíopack creó el pedido pero no devolvió su identificador.')
      enviopackOrderId = String(created.id)
    }
    await prisma.order.update({ where: { id: order.id }, data: { enviopackOrderId } })
  }

  const packages = inputPackages.map((item) => ({
    alto: item.alto,
    ancho: item.ancho,
    largo: item.largo,
    peso: Number(item.peso.toFixed(2)),
    descripcion_primera_linea: item.descripcion_primera_linea?.slice(0, 50) || 'Pedido ecommerceVM',
    descripcion_segunda_linea: item.descripcion_segunda_linea?.slice(0, 50) || order.code,
  }))
  let existingShipments: EnviopackResponse[] = []
  try {
    const linkedOrder = await requestEnviopack<{ envios_asociados?: EnviopackResponse[] }>('/pedidos/obtener-ids', {
      method: 'POST',
      body: JSON.stringify({ id_externo: order.code, plataforma: 'web' }),
    })
    existingShipments = Array.isArray(linkedOrder.envios_asociados) ? linkedOrder.envios_asociados : []
  } catch (error) {
    if (!(error instanceof EnviopackShipmentError && error.statusCode === 404)) throw error
  }
  const pendingShipment = existingShipments.find((item) => item.estado === 'E' && item.id)
  const incompleteShipment = existingShipments.find((item) => ['B', 'C'].includes(String(item.estado)) && item.id)
  if (incompleteShipment) {
    throw new EnviopackShipmentError('Este pedido ya tiene un envío en borrador o por confirmar en Envíopack. Revisalo en el panel de Envíopack antes de continuar.')
  }
  if (existingShipments.some((item) => item.id) && !pendingShipment) {
    throw new EnviopackShipmentError('Este pedido ya tiene un envío procesado en Envíopack, pero no está vinculado en ecommerceVM. Revisá el historial antes de generar otro para evitar un segundo despacho.')
  }
  if (pendingShipment && !order.enviopackPackages) {
    throw new EnviopackShipmentError('Ya existe un envío pendiente en Envíopack sin un registro local de sus bultos. Revisá ese envío en Envíopack antes de continuar para evitar duplicados o datos de embalaje incorrectos.')
  }
  if (order.enviopackPackages && JSON.stringify(order.enviopackPackages) !== JSON.stringify(packages)) {
    throw new EnviopackShipmentError('Los bultos de este pedido ya quedaron registrados. Para evitar inconsistencias con Envíopack, no se pueden modificar al reintentar la operación.')
  }
  if (!order.enviopackPackages) {
    await prisma.order.update({ where: { id: order.id }, data: { enviopackPackages: packages } })
  }
  const shipment = pendingShipment || await requestEnviopack<EnviopackResponse>('/envios', {
    method: 'POST',
    body: JSON.stringify({
      pedido: Number(enviopackOrderId),
      direccion_envio: origin.enviopackAddressId,
      destinatario: order.customerName.slice(0, 50),
      observaciones: order.customerNotes || undefined,
      confirmado: true,
      paquetes: packages,
      modalidad: 'D',
      servicio: String(selected.serviceCode),
      correo: carrierId,
      calle,
      numero,
      codigo_postal: Number(order.postalCode),
      provincia: order.provinceCode,
      localidad: order.city.slice(0, 50),
    }),
  })
  if (!shipment.id) throw new EnviopackShipmentError('Envíopack no devolvió el identificador del envío.')
  await prisma.order.update({
    where: { id: order.id },
    data: {
      enviopackShipmentId: String(shipment.id),
      enviopackShipmentStatus: shipment.estado || 'E',
      shippingCarrier: String(carrier.carrierName || carrierId),
      trackingCode: shipment.tracking_number ? String(shipment.tracking_number) : null,
    },
  })
  return { shipmentId: String(shipment.id), status: shipment.estado || 'E' }
}

export async function refreshEnviopackShipment(shipmentId: string) {
  const order = await prisma.order.findFirst({ where: { enviopackShipmentId: shipmentId } })
  if (!order) return null
  const shipment = await requestEnviopack<EnviopackResponse>(`/envios/${encodeURIComponent(shipmentId)}`)
  const processed = shipment.estado === 'P'
  await prisma.$transaction(async (tx) => {
    await tx.order.update({
      where: { id: order.id },
      data: {
        enviopackShipmentStatus: shipment.estado || order.enviopackShipmentStatus,
        enviopackTrackingNumber: shipment.tracking_number ? String(shipment.tracking_number) : order.enviopackTrackingNumber,
        trackingCode: shipment.tracking_number ? String(shipment.tracking_number) : order.trackingCode,
        ...(processed ? { enviopackProcessedAt: order.enviopackProcessedAt || new Date() } : {}),
        ...(processed && order.status === 'PREPARING' ? { status: 'SHIPPED' } : {}),
      },
    })
    if (processed && order.status === 'PREPARING') {
      await tx.orderStatusHistory.create({
        data: {
          orderId: order.id,
          fromStatus: 'PREPARING',
          toStatus: 'SHIPPED',
          note: 'Envíopack confirmó el procesamiento del envío. Etiqueta disponible.',
        },
      })
    }
  })
  let labelSaved = Boolean(order.enviopackLabelPdf)
  if (processed && !labelSaved) {
    try {
      const pdf = await downloadEnviopackLabel(shipmentId)
      await prisma.order.update({
        where: { id: order.id },
        data: { enviopackLabelPdf: pdf, enviopackLabelSavedAt: new Date() },
      })
      labelSaved = true
    } catch (error) {
      console.error('No se pudo archivar automáticamente la etiqueta de Envíopack:', error)
    }
  }
  return { orderId: order.id, status: shipment.estado || null, processed, labelSaved }
}

export async function downloadEnviopackLabel(shipmentId: string): Promise<Buffer> {
  const credentials = await getEnviopackCredentials()
  if (!credentials) throw new EnviopackShipmentError('Envíopack todavía no tiene credenciales configuradas.')
  const body = new URLSearchParams({ 'api-key': credentials.apiKey, 'secret-key': credentials.secretKey })
  const auth = await fetch('https://api.enviopack.com/auth', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(15000),
  })
  if (!auth.ok) throw new EnviopackShipmentError('Envíopack no pudo autenticar la cuenta.')
  const token = (await auth.json() as { access_token?: string }).access_token
  if (!token) throw new EnviopackShipmentError('Envíopack devolvió un token inválido.')
  const response = await fetch(`https://api.enviopack.com/envios/${encodeURIComponent(shipmentId)}/etiqueta?formato=pdf&access_token=${encodeURIComponent(token)}`, {
    signal: AbortSignal.timeout(25000),
  })
  if (!response.ok) throw new EnviopackShipmentError('La etiqueta todavía no está disponible. Envíopack debe procesar el envío primero.')
  return Buffer.from(await response.arrayBuffer())
}
