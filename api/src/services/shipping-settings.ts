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
    accountNumber: settings.ocaAccountNumberEncrypted ? decryptSecret(settings.ocaAccountNumberEncrypted) : null,
    costCenter: settings.ocaCostCenterEncrypted ? decryptSecret(settings.ocaCostCenterEncrypted) : null,
    originBranchId: settings.ocaOriginBranchIdEncrypted ? decryptSecret(settings.ocaOriginBranchIdEncrypted) : null,
    environment: settings.ocaEnvironment as 'QA' | 'PRODUCTION',
  }
}

export async function getStoredAndreaniCredentials() {
  const settings = await getShippingSettings()
  const values = [settings.andreaniUsernameEncrypted, settings.andreaniPasswordEncrypted, settings.andreaniClientCodeEncrypted, settings.andreaniContractEncrypted]
  if (values.some((value) => !value)) return null
  return {
    username: decryptSecret(settings.andreaniUsernameEncrypted!),
    password: decryptSecret(settings.andreaniPasswordEncrypted!),
    clientCode: decryptSecret(settings.andreaniClientCodeEncrypted!),
    contract: decryptSecret(settings.andreaniContractEncrypted!),
    environment: settings.andreaniEnvironment as 'QA' | 'PRODUCTION',
  }
}

export async function getShippingSettingsPublic() {
  const settings = await getShippingSettings()
  const ocaConfigured = Boolean(settings.ocaUsernameEncrypted && settings.ocaPasswordEncrypted && settings.ocaCuitEncrypted && settings.ocaOperativeEncrypted)
  const andreaniConfigured = Boolean(settings.andreaniUsernameEncrypted && settings.andreaniPasswordEncrypted && settings.andreaniClientCodeEncrypted && settings.andreaniContractEncrypted)
  return {
    pickup: { enabled: settings.pickupEnabled, address: settings.pickupAddress, instructions: settings.pickupInstructions, priceArs: 0 },
    localDelivery: {
      enabled: settings.localDeliveryEnabled,
      postalCodes: settings.localDeliveryPostalCodes,
      priceArs: settings.localDeliveryCoordinate ? null : settings.localDeliveryFeeArs,
      coordinate: settings.localDeliveryCoordinate,
    },
    oca: { enabled: ocaConfigured, environment: settings.ocaEnvironment },
    andreani: { enabled: andreaniConfigured, environment: settings.andreaniEnvironment },
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
  ocaAccountNumber?: string
  ocaCostCenter?: string
  ocaOriginBranchId?: string
  clearOcaCredentials?: boolean
  andreaniEnvironment: 'QA' | 'PRODUCTION'
  andreaniUsername?: string
  andreaniPassword?: string
  andreaniClientCode?: string
  andreaniContract?: string
  clearAndreaniCredentials?: boolean
}) {
  const current = await getShippingSettings()
  const ocaValues = [input.ocaUsername?.trim(), input.ocaPassword?.trim(), input.ocaCuit?.replace(/\\D/g, ''), input.ocaOperative?.trim()]
  const ocaHasAny = ocaValues.some(Boolean)
  const ocaHasComplete = ocaValues.every(Boolean)
  const ocaHasStored = Boolean(current.ocaUsernameEncrypted && current.ocaPasswordEncrypted && current.ocaCuitEncrypted && current.ocaOperativeEncrypted)
  const admissionValues = [input.ocaAccountNumber?.trim(), input.ocaCostCenter?.trim(), input.ocaOriginBranchId?.trim()]
  const admissionHasAny = admissionValues.some(Boolean)
  const admissionHasComplete = admissionValues.every(Boolean)
  if (admissionHasAny && !admissionHasComplete) throw new Error('Para admisión OCA completá número de cuenta, centro de costo e ID de sucursal de origen.')
  if (admissionHasComplete && (!/^\\d{1,10}\\/\\d{1,3}$/.test(admissionValues[0]!) || !/^\\d{1,10}$/.test(admissionValues[1]!) || !/^\\d{1,3}$/.test(admissionValues[2]!))) throw new Error('Revisá el formato de cuenta, centro de costo e ID de sucursal OCA.')
  const admissionHasStored = Boolean(current.ocaAccountNumberEncrypted && current.ocaCostCenterEncrypted && current.ocaOriginBranchIdEncrypted)
  if (ocaHasAny && !ocaHasComplete) throw new Error('Para guardar OCA completá usuario, contraseña, CUIT y operativa.')
  if (input.clearOcaCredentials && ocaHasAny) throw new Error('No podés reemplazar y eliminar las credenciales OCA en la misma operación.')
  if (input.ocaEnvironment === 'PRODUCTION' && !ocaHasStored && !ocaHasComplete) throw new Error('Configurá primero la cuenta OCA antes de seleccionar producción.')

  const andreaniValues = [input.andreaniUsername?.trim(), input.andreaniPassword?.trim(), input.andreaniClientCode?.trim(), input.andreaniContract?.trim()]
  const andreaniHasAny = andreaniValues.some(Boolean)
  const andreaniHasComplete = andreaniValues.every(Boolean)
  const andreaniHasStored = Boolean(current.andreaniUsernameEncrypted && current.andreaniPasswordEncrypted && current.andreaniClientCodeEncrypted && current.andreaniContractEncrypted)
  if (andreaniHasAny && !andreaniHasComplete) throw new Error('Para guardar Andreani completá usuario, contraseña, código de cliente y contrato.')
  if (input.andreaniEnvironment !== current.andreaniEnvironment && !andreaniHasComplete) throw new Error('Al cambiar el ambiente de Andreani, ingresá las credenciales correspondientes al nuevo ambiente.')
  if (input.clearAndreaniCredentials && andreaniHasAny) throw new Error('No podés reemplazar y eliminar las credenciales Andreani en la misma operación.')
  if (input.andreaniEnvironment === 'PRODUCTION' && !andreaniHasStored && !andreaniHasComplete) throw new Error('Configurá primero la cuenta Andreani antes de seleccionar producción.')

  return prisma.shippingSettings.upsert({
    where: { id: SETTINGS_ID },
    create: {
      id: SETTINGS_ID,
      ocaEnvironment: input.ocaEnvironment,
      ocaUsernameEncrypted: ocaHasComplete ? encryptSecret(input.ocaUsername!.trim()) : null,
      ocaPasswordEncrypted: ocaHasComplete ? encryptSecret(input.ocaPassword!.trim()) : null,
      ocaCuitEncrypted: ocaHasComplete ? encryptSecret(ocaValues[2]!) : null,
      ocaOperativeEncrypted: ocaHasComplete ? encryptSecret(input.ocaOperative!.trim()) : null,
      ocaAccountNumberEncrypted: admissionHasComplete ? encryptSecret(admissionValues[0]!) : null,
      ocaCostCenterEncrypted: admissionHasComplete ? encryptSecret(admissionValues[1]!) : null,
      ocaOriginBranchIdEncrypted: admissionHasComplete ? encryptSecret(admissionValues[2]!) : null,
      andreaniEnvironment: input.andreaniEnvironment,
      andreaniUsernameEncrypted: andreaniHasComplete ? encryptSecret(input.andreaniUsername!.trim()) : null,
      andreaniPasswordEncrypted: andreaniHasComplete ? encryptSecret(input.andreaniPassword!.trim()) : null,
      andreaniClientCodeEncrypted: andreaniHasComplete ? encryptSecret(input.andreaniClientCode!.trim()) : null,
      andreaniContractEncrypted: andreaniHasComplete ? encryptSecret(input.andreaniContract!.trim()) : null,
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
      ...(input.clearOcaCredentials ? { ocaUsernameEncrypted: null, ocaPasswordEncrypted: null, ocaCuitEncrypted: null, ocaOperativeEncrypted: null, ocaAccountNumberEncrypted: null, ocaCostCenterEncrypted: null, ocaOriginBranchIdEncrypted: null } : {}),
      ...(ocaHasComplete ? {
        ocaUsernameEncrypted: encryptSecret(input.ocaUsername!.trim()),
        ocaPasswordEncrypted: encryptSecret(input.ocaPassword!.trim()),
        ocaCuitEncrypted: encryptSecret(ocaValues[2]!),
        ocaOperativeEncrypted: encryptSecret(input.ocaOperative!.trim()),
      } : {}),
      ...(admissionHasComplete ? {
        ocaAccountNumberEncrypted: encryptSecret(admissionValues[0]!),
        ocaCostCenterEncrypted: encryptSecret(admissionValues[1]!),
        ocaOriginBranchIdEncrypted: encryptSecret(admissionValues[2]!),
      } : {}),
      andreaniEnvironment: input.andreaniEnvironment,
      ...(input.clearAndreaniCredentials ? { andreaniUsernameEncrypted: null, andreaniPasswordEncrypted: null, andreaniClientCodeEncrypted: null, andreaniContractEncrypted: null } : {}),
      ...(andreaniHasComplete ? {
        andreaniUsernameEncrypted: encryptSecret(input.andreaniUsername!.trim()),
        andreaniPasswordEncrypted: encryptSecret(input.andreaniPassword!.trim()),
        andreaniClientCodeEncrypted: encryptSecret(input.andreaniClientCode!.trim()),
        andreaniContractEncrypted: encryptSecret(input.andreaniContract!.trim()),
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
