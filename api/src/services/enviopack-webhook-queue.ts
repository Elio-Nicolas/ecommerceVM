import { prisma } from '../lib/prisma'
import { refreshEnviopackShipment } from './enviopack-shipments'
import { enviopackShippingProvider } from './enviopack-provider'

let timer: ReturnType<typeof setInterval> | null = null
let running = false

async function processNextNeutralEvent(): Promise<boolean> {
  const now = new Date()
  const staleLock = new Date(now.getTime() - 2 * 60 * 1000)
  const candidate = await prisma.shippingShipmentEvent.findFirst({
    where: {
      OR: [
        { status: 'RECEIVED' },
        { status: 'PENDING' },
        { status: 'PROCESSING', lockedAt: { lt: staleLock } },
      ],
    },
    orderBy: { receivedAt: 'asc' },
  })
  if (!candidate) return false

  const claimed = await prisma.shippingShipmentEvent.updateMany({
    where: {
      id: candidate.id,
      OR: [
        { status: 'RECEIVED' },
        { status: 'PENDING' },
        { status: 'PROCESSING', lockedAt: { lt: staleLock } },
      ],
    },
    data: { status: 'PROCESSING', lockedAt: now },
  })
  if (claimed.count !== 1) return true

  try {
    const shipment = await prisma.shippingShipment.findUnique({
      where: { id: candidate.shipmentId },
      select: { id: true, provider: true, externalAdmissionId: true },
    })
    if (!shipment || shipment.provider !== 'ENVIOPACK' || !shipment.externalAdmissionId) {
      await prisma.shippingShipmentEvent.update({
        where: { id: candidate.id },
        data: { status: 'IGNORED', processedAt: new Date(), lockedAt: null, lastError: 'El envío no tiene un identificador Envíopack procesable.' },
      })
      return true
    }

    await enviopackShippingProvider.refreshShipment(shipment.externalAdmissionId)
    await prisma.shippingShipmentEvent.update({
      where: { id: candidate.id },
      data: { status: 'PROCESSED', processedAt: new Date(), lockedAt: null, lastError: null },
    })
  } catch (error) {
    const attempts = candidate.attempts + 1
    const message = (error instanceof Error ? error.message : 'Error desconocido').slice(0, 1000)
    await prisma.$transaction([
      prisma.shippingShipmentEvent.update({
        where: { id: candidate.id },
        data: {
          attempts,
          status: attempts >= 10 ? 'FAILED' : 'PENDING',
          lockedAt: null,
          lastError: message,
        },
      }),
      prisma.shippingShipment.update({
        where: { id: candidate.shipmentId },
        data: { lastError: message },
      }),
    ])
  }
  return true
}

async function processNextLegacyEvent() {
  const now = new Date()
  const staleLock = new Date(now.getTime() - 2 * 60 * 1000)
  const candidate = await prisma.enviopackWebhookEvent.findFirst({
    where: {
      OR: [
        { status: 'PENDING' },
        { status: 'PROCESSING', lockedAt: { lt: staleLock } },
      ],
    },
    orderBy: { receivedAt: 'asc' },
  })
  if (!candidate) return
  const claimed = await prisma.enviopackWebhookEvent.updateMany({
    where: {
      id: candidate.id,
      OR: [
        { status: 'PENDING' },
        { status: 'PROCESSING', lockedAt: { lt: staleLock } },
      ],
    },
    data: { status: 'PROCESSING', lockedAt: now },
  })
  if (claimed.count !== 1) return

  try {
    const order = await prisma.order.findFirst({ where: { enviopackShipmentId: candidate.shipmentId }, select: { id: true } })
    if (!order) {
      await prisma.enviopackWebhookEvent.update({
        where: { id: candidate.id },
        data: { status: 'IGNORED', processedAt: new Date(), lockedAt: null, lastError: 'El envío no pertenece a un pedido registrado.' },
      })
      return
    }
    await refreshEnviopackShipment(candidate.shipmentId)
    await prisma.enviopackWebhookEvent.update({
      where: { id: candidate.id },
      data: { status: 'PROCESSED', processedAt: new Date(), lockedAt: null, lastError: null },
    })
  } catch (error) {
    const attempts = candidate.attempts + 1
    await prisma.enviopackWebhookEvent.update({
      where: { id: candidate.id },
      data: {
        attempts,
        status: attempts >= 10 ? 'FAILED' : 'PENDING',
        lockedAt: null,
        lastError: (error instanceof Error ? error.message : 'Error desconocido').slice(0, 1000),
      },
    })
  }
}

async function processNextEvent() {
  if (await processNextNeutralEvent()) return
  await processNextLegacyEvent()
}

export function startEnviopackWebhookWorker() {
  if (timer) return
  timer = setInterval(() => {
    if (running) return
    running = true
    void processNextEvent().catch((error) => console.error('Error en cola de eventos de logística:', error)).finally(() => { running = false })
  }, 3000)
  timer.unref?.()
}

export function stopEnviopackWebhookWorker() {
  if (timer) clearInterval(timer)
  timer = null
}
