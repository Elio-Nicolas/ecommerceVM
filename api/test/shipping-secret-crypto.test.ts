import assert from 'node:assert/strict'
import test from 'node:test'
import { decryptShippingSecret, encryptShippingSecret } from '../src/services/shipping-secret-crypto'

const jwtSecret = 'legacy-jwt-secret-that-is-long-enough-for-tests'
const dedicatedKey = 'dedicated-shipping-encryption-key-for-tests'

test('cifra nuevas credenciales con clave dedicada y formato versionado', () => {
  const encrypted = encryptShippingSecret('oca-password-sensitive', { jwtSecret, shippingEncryptionKey: dedicatedKey })
  assert.match(encrypted, /^v2\./)
  assert.equal(encrypted.includes('oca-password-sensitive'), false)
  assert.equal(decryptShippingSecret(encrypted, { jwtSecret, shippingEncryptionKey: dedicatedKey }), 'oca-password-sensitive')
})

test('mantiene compatibilidad con credenciales legacy aunque exista la clave dedicada', () => {
  const legacy = encryptShippingSecret('legacy-enviopack-secret', { jwtSecret })
  assert.doesNotMatch(legacy, /^v2\./)
  assert.equal(decryptShippingSecret(legacy, { jwtSecret, shippingEncryptionKey: dedicatedKey }), 'legacy-enviopack-secret')
})

test('rechaza credenciales v2 cuando falta la clave dedicada', () => {
  const encrypted = encryptShippingSecret('oca-user', { jwtSecret, shippingEncryptionKey: dedicatedKey })
  assert.throws(
    () => decryptShippingSecret(encrypted, { jwtSecret }),
    /Falta SHIPPING_ENCRYPTION_KEY/,
  )
})

test('rechaza una clave incorrecta, datos alterados y formatos inválidos', () => {
  const encrypted = encryptShippingSecret('oca-password', { jwtSecret, shippingEncryptionKey: dedicatedKey })
  assert.throws(
    () => decryptShippingSecret(encrypted, { jwtSecret, shippingEncryptionKey: 'another-dedicated-key-with-enough-length' }),
  )
  const [version, iv, tag, ciphertext] = encrypted.split('.')
  const altered = `${version}.${iv}.${tag}.${ciphertext.slice(0, -1)}${ciphertext.endsWith('A') ? 'B' : 'A'}`
  assert.throws(() => decryptShippingSecret(altered, { jwtSecret, shippingEncryptionKey: dedicatedKey }))
  assert.throws(() => decryptShippingSecret('v2.invalid', { jwtSecret, shippingEncryptionKey: dedicatedKey }), /formato válido/)
})
