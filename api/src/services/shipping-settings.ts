import { prisma } from '../lib/prisma'
import { env } from '../config/env'
import { decryptShippingSecret, encryptShippingSecret } from './shipping-secret-crypto'

const SETTINGS_ID = 'default'
const encryptionConfig = { jwtSecret: env.JWT_SECRET, shippingEncryptionKey: env.SHIPPING_ENCRYPTION_KEY }
const encryptSecret = (value: string) => encryptShippingSecret(value, encryptionConfig)
const decryptSecret = (value: string) => decryptShippingSecret(value, encryptionConfig)

export async function getShippingSettings() {
  return prisma.shippingSettings.upsert({
    where: { id: SETTINGS_ID },
    create: {
      id: SETTINGS_ID,
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

export async function getStoredOcaCredentials() {
  const settings = await getShippingSettings()
  const values = [settings.ocaUsernameEncrypted, settings.ocaPasswordEncrypted, settings.ocaCuitEncrypted, settings.ocaOperativeEncrypted]
  if (values.some((value) => !value)) return null
  return {
    username: decryptSecret(settings.ocaUsernameEncrypted!),
    password: decryptSecret(settings.ocaPasswordEncrypted!),
    cuit: decryptSecret(settings.ocaCuitEncrypted!),
    operative: decryptSecret(settings.ocaOperativeEncrypted!),
    environment: settings.ocaEnvironment as 'QA' | 'PRODUCTION',
  }
}

export async function getShippingSettingsPublic() {
  const settings = await getShippingSettings()
  const ocaConfigured = Boolean(settings.ocaUsernameEncrypted && settings.ocaPasswordEncrypted && settings.ocaCuitEncrypted && settings.ocaOperativeEncrypted)
  return {
    pickup: { enabled: settings.pickupEnabled, address: settings.pickupAddress, instructions: settings.pickupInstructions, priceArs: 0 },
    localDelivery: {
      enabled: settings.localDeliveryEnabled,
      postalCodes: settings.localDeliveryPostalCodes,
      priceArs: settings.localDeliveryCoordinate ? null : settings.localDeliveryFeeArs,
      coordinate: settings.localDeliveryCoordinate,
    },
    oca: { enabled: ocaConfigured, environment: settings.ocaEnvironment },
  }
}

export async function saveShippingSettings(input: {
  pickupEnabled: boolean
  pickupAddress: string
  pickupInstructions: string
  localDeliveryEnabled: boolean
  localDeliveryPostalCodes: string[]
  localDeliveryFeeArs: number
  localDeliveryInternalCostArs: number | null
  localDeliveryCoordinate: boolean
  ocaEnvironment: 'QA' | 'PRODUCTION'
  ocaUsername?: string
  ocaPassword?: string
  ocaCuit?: string
  ocaOperative?: string
  clearOcaCredentials?: boolean
}) {
  const current = await getShippingSettings()
  const values = [input.ocaUsername?.trim(), input.ocaPassword?.trim(), input.ocaCuit?.replace(/\\D/g, ''), input.ocaOperative?.trim()]
  const hasAny = values.some(Boolean)
  const hasComplete = values.every(Boolean)
  const hasStored = Boolean(current.ocaUsernameEncrypted && current.ocaPasswordEncrypted && current.ocaCuitEncrypted && current.ocaOperativeEncrypted)
  if (hasAny && !hasComplete) throw new Error('Para guardar OCA completá usuario, contraseña, CUIT y operativa.')
  if (input.clearOcaCredentials && hasAny) throw new Error('No podés reemplazar y eliminar las credenciales OCA en la misma operación.')
  if (input.ocaEnvironment === 'PRODUCTION' && !hasStored && !hasComplete) throw new Error('Configurá primero la cuenta OCA antes de seleccionar producción.')

  return prisma.shippingSettings.upsert({
    where: { id: SETTINGS_ID },
    create: {
      id: SETTINGS_ID,
      ocaEnvironment: input.ocaEnvironment,
      ocaUsernameEncrypted: hasComplete ? encryptSecret(input.ocaUsername!.trim()) : null,
      ocaPasswordEncrypted: hasComplete ? encryptSecret(input.ocaPassword!.trim()) : null,
      ocaCuitEncrypted: hasComplete ? encryptSecret(values[2]!) : null,
      ocaOperativeEncrypted: hasComplete ? encryptSecret(input.ocaOperative!.trim()) : null,
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
      ocaEnvironment: input.ocaEnvironment,
      ...(input.clearOcaCredentials ? { ocaUsernameEncrypted: null, ocaPasswordEncrypted: null, ocaCuitEncrypted: null, ocaOperativeEncrypted: null } : {}),
      ...(hasComplete ? {
        ocaUsernameEncrypted: encryptSecret(input.ocaUsername!.trim()),
        ocaPasswordEncrypted: encryptSecret(input.ocaPassword!.trim()),
        ocaCuitEncrypted: encryptSecret(values[2]!),
        ocaOperativeEncrypted: encryptSecret(input.ocaOperative!.trim()),
      } : {}),
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
