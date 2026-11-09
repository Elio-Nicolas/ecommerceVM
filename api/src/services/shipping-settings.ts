import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto'
import { prisma } from '../lib/prisma'
import { env } from '../config/env'

const SETTINGS_ID = 'default'
const encryptionKey = () => scryptSync(env.JWT_SECRET, 'ecommercevm-shipping-settings-v1', 32)

function encryptSecret(value: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv)
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  return [iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), encrypted.toString('base64url')].join('.')
}

function decryptSecret(value: string): string {
  const [ivValue, tagValue, encryptedValue] = value.split('.')
  if (!ivValue || !tagValue || !encryptedValue) throw new Error('La credencial almacenada no tiene un formato válido.')
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(ivValue, 'base64url'))
  decipher.setAuthTag(Buffer.from(tagValue, 'base64url'))
  return Buffer.concat([decipher.update(Buffer.from(encryptedValue, 'base64url')), decipher.final()]).toString('utf8')
}

export async function getShippingSettings() {
  return prisma.shippingSettings.upsert({
    where: { id: SETTINGS_ID },
    create: {
      id: SETTINGS_ID,
      enviopackEnabled: Boolean(env.ENVIOPACK_API_KEY && env.ENVIOPACK_SECRET_KEY),
      enviopackApiKeyEncrypted: env.ENVIOPACK_API_KEY ? encryptSecret(env.ENVIOPACK_API_KEY) : null,
      enviopackSecretKeyEncrypted: env.ENVIOPACK_SECRET_KEY ? encryptSecret(env.ENVIOPACK_SECRET_KEY) : null,
      pickupEnabled: env.PICKUP_ENABLED,
      pickupAddress: env.PICKUP_ADDRESS,
      pickupInstructions: env.PICKUP_INSTRUCTIONS,
      localDeliveryEnabled: env.LOCAL_DELIVERY_ENABLED,
      localDeliveryPostalCodes: env.LOCAL_DELIVERY_POSTAL_CODES.split(',').map((value) => value.trim()).filter(Boolean),
      localDeliveryFeeArs: env.LOCAL_DELIVERY_FEE_ARS,
      localDeliveryInternalCostArs: env.LOCAL_DELIVERY_INTERNAL_COST_ARS ?? null,
      localDeliveryCoordinate: env.LOCAL_DELIVERY_COORDINATE,
    },
    update: {},
  })
}

export async function getShippingSettingsPublic() {
  const settings = await getShippingSettings()
  const hasCredentials = Boolean(settings.enviopackApiKeyEncrypted && settings.enviopackSecretKeyEncrypted)
  return {
    pickup: {
      enabled: settings.pickupEnabled,
      address: settings.pickupAddress,
      instructions: settings.pickupInstructions,
      priceArs: 0,
    },
    localDelivery: {
      enabled: settings.localDeliveryEnabled,
      postalCodes: settings.localDeliveryPostalCodes,
      priceArs: settings.localDeliveryCoordinate ? null : settings.localDeliveryFeeArs,
      coordinate: settings.localDeliveryCoordinate,
    },
    enviopack: { enabled: settings.enviopackEnabled && hasCredentials },
  }
}

export async function getStoredEnviopackCredentials() {
  const settings = await getShippingSettings()
  if (!settings.enviopackApiKeyEncrypted || !settings.enviopackSecretKeyEncrypted) return null
  return {
    apiKey: decryptSecret(settings.enviopackApiKeyEncrypted),
    secretKey: decryptSecret(settings.enviopackSecretKeyEncrypted),
  }
}

export async function getEnviopackCredentials() {
  const settings = await getShippingSettings()
  if (!settings.enviopackEnabled) return null
  return getStoredEnviopackCredentials()
}

export async function saveShippingSettings(input: {
  enviopackEnabled: boolean
  enviopackApiKey?: string
  enviopackSecretKey?: string
  clearEnviopackCredentials?: boolean
  pickupEnabled: boolean
  pickupAddress: string
  pickupInstructions: string
  localDeliveryEnabled: boolean
  localDeliveryPostalCodes: string[]
  localDeliveryFeeArs: number
  localDeliveryInternalCostArs: number | null
  localDeliveryCoordinate: boolean
}) {
  const current = await getShippingSettings()
  const clear = input.clearEnviopackCredentials === true
  const apiKey = input.enviopackApiKey?.trim()
  const secretKey = input.enviopackSecretKey?.trim()
  const hasNewPair = Boolean(apiKey && secretKey)
  if ((apiKey && !secretKey) || (!apiKey && secretKey)) {
    throw new Error('Ingresá la API Key y la Secret Key juntas para actualizar las credenciales.')
  }
  if (input.enviopackEnabled && clear && !hasNewPair) {
    throw new Error('No podés habilitar Envíopack si eliminás sus credenciales.')
  }
  if (input.enviopackEnabled && !hasNewPair && (!current.enviopackApiKeyEncrypted || !current.enviopackSecretKeyEncrypted)) {
    throw new Error('Para habilitar Envíopack primero guardá ambas credenciales.')
  }

  return prisma.shippingSettings.upsert({
    where: { id: SETTINGS_ID },
    create: {
      id: SETTINGS_ID,
      enviopackEnabled: input.enviopackEnabled,
      enviopackApiKeyEncrypted: hasNewPair ? encryptSecret(apiKey!) : null,
      enviopackSecretKeyEncrypted: hasNewPair ? encryptSecret(secretKey!) : null,
      pickupEnabled: input.pickupEnabled,
      pickupAddress: input.pickupAddress,
      pickupInstructions: input.pickupInstructions,
      localDeliveryEnabled: input.localDeliveryEnabled,
      localDeliveryPostalCodes: input.localDeliveryPostalCodes,
      localDeliveryFeeArs: input.localDeliveryFeeArs,
      localDeliveryInternalCostArs: input.localDeliveryInternalCostArs,
      localDeliveryCoordinate: input.localDeliveryCoordinate,
    },
    update: {
      enviopackEnabled: input.enviopackEnabled,
      ...(clear ? { enviopackApiKeyEncrypted: null, enviopackSecretKeyEncrypted: null } : {}),
      ...(hasNewPair ? { enviopackApiKeyEncrypted: encryptSecret(apiKey!), enviopackSecretKeyEncrypted: encryptSecret(secretKey!) } : {}),
      pickupEnabled: input.pickupEnabled,
      pickupAddress: input.pickupAddress,
      pickupInstructions: input.pickupInstructions,
      localDeliveryEnabled: input.localDeliveryEnabled,
      localDeliveryPostalCodes: input.localDeliveryPostalCodes,
      localDeliveryFeeArs: input.localDeliveryFeeArs,
      localDeliveryInternalCostArs: input.localDeliveryInternalCostArs,
      localDeliveryCoordinate: input.localDeliveryCoordinate,
    },
  })
}