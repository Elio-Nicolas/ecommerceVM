import { prisma } from '../lib/prisma'
import { refreshEnviopackShipment } from './enviopack-shipments'

let timer: ReturnType<typeof setInterval> | null = null
let running = false

async function processNextEvent() {
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

export function startEnviopackWebhookWorker() {
  if (timer) return
  timer = setInterval(() => {
    if (running) return
    running = true
    void processNextEvent().catch((error) => console.error('Error en cola de webhooks Envíopack:', error)).finally(() => { running = false })
  }, 3000)
  timer.unref?.()
}

export function stopEnviopackWebhookWorker() {
  if (timer) clearInterval(timer)
  timer = null
}
