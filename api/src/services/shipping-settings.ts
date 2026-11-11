import { prisma } from '../lib/prisma'
import { env } from '../config/env'
import { decryptShippingSecret, encryptShippingSecret } from './shipping-secret-crypto'

const SETTINGS_ID = 'default'
const encryptionConfig = {
  jwtSecret: env.JWT_SECRET,
  shippingEncryptionKey: env.SHIPPING_ENCRYPTION_KEY,
}
const encryptSecret = (value: string) => encryptShippingSecret(value, encryptionConfig)
const decryptSecret = (value: string) => decryptShippingSecret(value, encryptionConfig)

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
    // Envíopack queda disponible solo para operaciones históricas de administración.\n    // No ofrecer nuevos envíos hasta completar la migración a OCA.\n    enviopack: { enabled: false },
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

export async function getStoredOcaCredentials() {
  const settings = await getShippingSettings()
  const values = [
    settings.ocaUsernameEncrypted,
    settings.ocaPasswordEncrypted,
    settings.ocaCuitEncrypted,
    settings.ocaOperativeEncrypted,
  ]
  if (values.some((value) => !value)) return null
  return {
    username: decryptSecret(settings.ocaUsernameEncrypted!),
    password: decryptSecret(settings.ocaPasswordEncrypted!),
    cuit: decryptSecret(settings.ocaCuitEncrypted!),
    operative: decryptSecret(settings.ocaOperativeEncrypted!),
    environment: settings.ocaEnvironment,
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
  ocaEnvironment?: 'QA' | 'PRODUCTION'
  ocaUsername?: string
  ocaPassword?: string
  ocaCuit?: string
  ocaOperative?: string
  clearOcaCredentials?: boolean
}) {
  const current = await getShippingSettings()
  const clear = input.clearEnviopackCredentials === true
  const apiKey = input.enviopackApiKey?.trim()
  const secretKey = input.enviopackSecretKey?.trim()
  const hasNewPair = Boolean(apiKey && secretKey)
  const ocaValues = [input.ocaUsername?.trim(), input.ocaPassword?.trim(), input.ocaCuit?.trim(), input.ocaOperative?.trim()]
  const hasAnyOcaValue = ocaValues.some(Boolean)
  const hasCompleteOcaSet = ocaValues.every(Boolean)
  const hasStoredOcaSet = Boolean(current.ocaUsernameEncrypted && current.ocaPasswordEncrypted && current.ocaCuitEncrypted && current.ocaOperativeEncrypted)
  if (hasAnyOcaValue && !hasCompleteOcaSet) throw new Error('Para guardar OCA completá usuario, contraseña, CUIT y operativa.')
  if (input.clearOcaCredentials && hasAnyOcaValue) throw new Error('No podés reemplazar y eliminar las credenciales OCA en la misma operación.')
  if (!input.clearOcaCredentials && !hasAnyOcaValue && !hasStoredOcaSet && input.ocaEnvironment === 'PRODUCTION') {
    throw new Error('Configurá primero la cuenta OCA antes de seleccionar producción.')
  }
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
      ocaEnvironment: input.ocaEnvironment ?? 'QA',
      ocaUsernameEncrypted: hasCompleteOcaSet ? encryptSecret(input.ocaUsername!.trim()) : null,
      ocaPasswordEncrypted: hasCompleteOcaSet ? encryptSecret(input.ocaPassword!.trim()) : null,
      ocaCuitEncrypted: hasCompleteOcaSet ? encryptSecret(input.ocaCuit!.trim()) : null,
      ocaOperativeEncrypted: hasCompleteOcaSet ? encryptSecret(input.ocaOperative!.trim()) : null,
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
      ocaEnvironment: input.ocaEnvironment ?? current.ocaEnvironment,
      ...(input.clearOcaCredentials ? { ocaUsernameEncrypted: null, ocaPasswordEncrypted: null, ocaCuitEncrypted: null, ocaOperativeEncrypted: null } : {}),
      ...(hasCompleteOcaSet ? {
        ocaUsernameEncrypted: encryptSecret(input.ocaUsername!.trim()),
        ocaPasswordEncrypted: encryptSecret(input.ocaPassword!.trim()),
        ocaCuitEncrypted: encryptSecret(input.ocaCuit!.trim()),
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