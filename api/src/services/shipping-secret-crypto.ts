import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto'

export type ShippingSecretKeyConfig = {
  jwtSecret: string
  shippingEncryptionKey?: string
}

function deriveLegacyKey(jwtSecret: string): Buffer {
  return scryptSync(jwtSecret, 'ecommercevm-shipping-settings-v1', 32)
}

function deriveDedicatedKey(shippingEncryptionKey: string): Buffer {
  return scryptSync(shippingEncryptionKey, 'ecommercevm-shipping-settings-v2', 32)
}

export function encryptShippingSecret(value: string, config: ShippingSecretKeyConfig): string {
  const useDedicatedKey = Boolean(config.shippingEncryptionKey)
  const key = useDedicatedKey
    ? deriveDedicatedKey(config.shippingEncryptionKey!)
    : deriveLegacyKey(config.jwtSecret)
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  const payload = [
    iv.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    encrypted.toString('base64url'),
  ].join('.')
  return useDedicatedKey ? `v2.${payload}` : payload
}

export function decryptShippingSecret(value: string, config: ShippingSecretKeyConfig): string {
  const parts = value.split('.')
  const isV2 = parts.length === 4 && parts[0] === 'v2'
  if ((!isV2 && parts.length !== 3) || (isV2 && parts.length !== 4)) {
    throw new Error('La credencial almacenada no tiene un formato válido.')
  }

  const [ivValue, tagValue, encryptedValue] = isV2 ? parts.slice(1) : parts
  if (!ivValue || !tagValue || !encryptedValue) {
    throw new Error('La credencial almacenada no tiene un formato válido.')
  }
  if (isV2 && !config.shippingEncryptionKey) {
    throw new Error('Falta SHIPPING_ENCRYPTION_KEY para descifrar las credenciales de integraciones.')
  }

  const key = isV2
    ? deriveDedicatedKey(config.shippingEncryptionKey!)
    : deriveLegacyKey(config.jwtSecret)
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivValue, 'base64url'))
  decipher.setAuthTag(Buffer.from(tagValue, 'base64url'))
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedValue, 'base64url')),
    decipher.final(),
  ]).toString('utf8')
}
