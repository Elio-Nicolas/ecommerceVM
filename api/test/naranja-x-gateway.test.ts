import assert from 'node:assert/strict'
import test from 'node:test'
import { NaranjaXSimulator } from '../src/services/naranja-x-gateway'

const base = {
  orderId: 'order-1',
  orderReference: 'VM-1001',
  amountArs: 125000,
  currency: 'ARS' as const,
  idempotencyKey: 'idem-1',
  returnUrl: 'https://tienda.example/checkout/return',
  webhookUrl: 'https://api.example/payments/naranja-x/webhook',
}

test('simulator creates a pending checkout without a real payment endpoint', async () => {
  const gateway = new NaranjaXSimulator()
  const checkout = await gateway.createCheckout(base)
  assert.equal(checkout.status, 'PENDING')
  assert.equal(checkout.amountArs, base.amountArs)
  assert.equal(checkout.orderReference, base.orderReference)
  assert.match(checkout.checkoutUrl, /^https:\/\/naranja-x-simulator\.invalid\//)
  assert.equal((await gateway.getPayment(checkout.providerPaymentId)).status, 'PENDING')
})

test('same idempotency key and same operation return the same checkout', async () => {
  const gateway = new NaranjaXSimulator()
  const first = await gateway.createCheckout(base)
  const second = await gateway.createCheckout(base)
  assert.equal(second.providerPaymentId, first.providerPaymentId)
  assert.equal(second.checkoutUrl, first.checkoutUrl)
})

test('idempotency key cannot be reused with a different order or amount', async () => {
  const gateway = new NaranjaXSimulator()
  await gateway.createCheckout(base)
  await assert.rejects(
    gateway.createCheckout({ ...base, amountArs: 125001 }),
    /idempotencia/,
  )
})

test('invalid amount, currency and callback URLs are rejected', async () => {
  const gateway = new NaranjaXSimulator()
  await assert.rejects(gateway.createCheckout({ ...base, amountArs: 0 }), /entero positivo/)
  await assert.rejects(gateway.createCheckout({ ...base, currency: 'USD' as 'ARS' }), /ARS/)
  await assert.rejects(gateway.createCheckout({ ...base, webhookUrl: 'javascript:alert(1)' }), /URLs/)
})

test('simulator supports approved and partial/full refund states for workflow tests', async () => {
  const gateway = new NaranjaXSimulator()
  const checkout = await gateway.createCheckout(base)
  gateway.simulateStatus(checkout.providerPaymentId, 'APPROVED')
  assert.equal((await gateway.getPayment(checkout.providerPaymentId)).status, 'APPROVED')

  gateway.simulateStatus(checkout.providerPaymentId, 'PARTIALLY_REFUNDED', 25000)
  assert.equal((await gateway.getPayment(checkout.providerPaymentId)).refundedAmountArs, 25000)

  gateway.simulateStatus(checkout.providerPaymentId, 'REFUNDED', base.amountArs)
  assert.equal((await gateway.getPayment(checkout.providerPaymentId)).status, 'REFUNDED')
})

test('refund transitions reject inconsistent amounts', async () => {
  const gateway = new NaranjaXSimulator()
  const checkout = await gateway.createCheckout(base)
  assert.throws(() => gateway.simulateStatus(checkout.providerPaymentId, 'PARTIALLY_REFUNDED', base.amountArs), /parcial/)
  assert.throws(() => gateway.simulateStatus(checkout.providerPaymentId, 'REFUNDED', 1), /total/)
  assert.throws(() => gateway.simulateStatus(checkout.providerPaymentId, 'APPROVED', 1), /Solo/)
})
