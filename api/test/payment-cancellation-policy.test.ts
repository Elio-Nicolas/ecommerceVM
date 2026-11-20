import assert from 'node:assert/strict'
import test from 'node:test'
import { getPaymentCancellationBlock, hasUnresolvedOnlinePayment } from '../src/services/payment-cancellation-policy'

test('bloquea pagos aprobados de cualquier proveedor', () => {
  assert.equal(getPaymentCancellationBlock([{ provider: 'GOCUOTAS', status: 'APPROVED' }]), 'PAYMENT_APPROVED')
  assert.equal(getPaymentCancellationBlock([{ provider: 'MERCADO_PAGO', status: 'PARTIALLY_REFUNDED' }]), 'PAYMENT_APPROVED')
})

test('bloquea intentos pendientes o inciertos de cualquier proveedor', () => {
  for (const provider of ['MERCADO_PAGO', 'GOCUOTAS']) {
    for (const status of ['CREATING', 'PENDING', 'UNKNOWN']) {
      const attempts = [{ provider, status }]
      assert.equal(getPaymentCancellationBlock(attempts), 'PAYMENT_UNRESOLVED')
      assert.equal(hasUnresolvedOnlinePayment(attempts), true)
    }
  }
})

test('permite cancelar cuando no hay cobro o el intento terminó sin cobrar', () => {
  assert.equal(getPaymentCancellationBlock([]), null)
  assert.equal(getPaymentCancellationBlock([{ provider: 'GOCUOTAS', status: 'REJECTED' }]), null)
  assert.equal(getPaymentCancellationBlock([{ provider: 'MERCADO_PAGO', status: 'CANCELLED' }]), null)
  assert.equal(getPaymentCancellationBlock([{ provider: 'GOCUOTAS', status: 'REFUNDED' }]), null)
  assert.equal(hasUnresolvedOnlinePayment([{ provider: 'GOCUOTAS', status: 'REJECTED' }]), false)
})
