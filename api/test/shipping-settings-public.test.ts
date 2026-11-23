import assert from 'node:assert/strict'
import test from 'node:test'
import { toPublicPickupSettings } from '../src/services/shipping-settings'

test('la respuesta pública de retiro nunca incluye domicilio ni instrucciones privadas', () => {
  const publicPickup = toPublicPickupSettings({
    pickupEnabled: true,
    pickupAddress: 'Calle privada 123',
    pickupInstructions: 'Tocar timbre en la casa',
  })

  assert.deepEqual(publicPickup, {
    enabled: true,
    instructions: 'La dirección y el horario se coordinarán después de confirmar la compra.',
    priceArs: 0,
  })
  assert.equal(JSON.stringify(publicPickup).includes('Calle privada 123'), false)
  assert.equal(JSON.stringify(publicPickup).includes('Tocar timbre en la casa'), false)
})
