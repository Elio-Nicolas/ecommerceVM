import { prisma } from '../lib/prisma'

const SETTINGS_ID = 'default'

export async function getPaymentMethodSettings() {
  return prisma.paymentSettings.upsert({
    where: { id: SETTINGS_ID },
    create: { id: SETTINGS_ID },
    update: {},
  })
}

export async function savePaymentMethodSettings(input: {
  mercadoPagoEnabled: boolean
  goCuotasEnabled: boolean
  naranjaXEnabled: boolean
}) {
  return prisma.paymentSettings.upsert({
    where: { id: SETTINGS_ID },
    create: { id: SETTINGS_ID, ...input },
    update: input,
  })
}
