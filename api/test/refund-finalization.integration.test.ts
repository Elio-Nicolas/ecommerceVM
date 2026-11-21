import assert from 'node:assert/strict'
import test from 'node:test'
import { randomUUID } from 'node:crypto'
import { prisma } from '../src/lib/prisma'
import { finalizePreDispatchRefund } from '../src/services/refund-finalization'
import { acceptReturnedOrderStock } from '../src/services/return-acceptance'

const databaseAvailable = Boolean(process.env.DATABASE_URL)

async function createRefundFixture(status: 'PREPARING' | 'SHIPPED') {
  const key = randomUUID()
  const category = await prisma.category.create({ data: { name: 'CI ' + key, slug: 'ci-' + key } })
  const product = await prisma.product.create({
    data: { sku: 'CI-' + key, slug: 'ci-' + key, name: 'Producto CI', description: 'Fixture de integración', priceArs: 100, stock: 0, status: 'ACTIVE', categoryId: category.id },
  })
  const order = await prisma.order.create({
    data: {
      code: 'CI-' + key,
      status,
      customerName: 'Comprador CI',
      customerEmail: 'ci@example.invalid',
      customerPhone: '2604000000',
      addressLine: 'Calle de prueba 123',
      city: 'Villa Mercedes',
      province: 'San Luis',
      postalCode: '5730',
      subtotalArs: 200,
      totalArs: 200,
      paymentMethod: 'CASH',
      deliveryMethod: 'PICKUP',
      items: { create: { productId: product.id, productName: product.name, productSku: product.sku, unitPriceArs: 100, quantity: 2, lineTotalArs: 200 } },
    },
  })
  await prisma.cancellationRequest.create({
    data: { orderId: order.id, customerEmail: 'ci@example.invalid', status: status === 'SHIPPED' ? 'REQUESTED' : 'REFUNDED', returnStatus: status === 'SHIPPED' ? 'RETURN_PENDING' : 'NOT_REQUIRED' },
  })
  return { key, categoryId: category.id, productId: product.id, orderId: order.id }
}

async function cleanupFixture(fixture: Awaited<ReturnType<typeof createRefundFixture>>) {
  await prisma.cancellationRequest.deleteMany({ where: { orderId: fixture.orderId } })
  await prisma.order.deleteMany({ where: { id: fixture.orderId } })
  await prisma.product.deleteMany({ where: { id: fixture.productId } })
  await prisma.category.deleteMany({ where: { id: fixture.categoryId } })
}

test('un reintegro confirmado cancela el pedido previo al despacho y repone stock una sola vez', { skip: !databaseAvailable }, async () => {
  const fixture = await createRefundFixture('PREPARING')
  try {
    assert.equal(await finalizePreDispatchRefund(fixture.orderId, null, 'CI refund'), 'CANCELLED')
    assert.equal(await finalizePreDispatchRefund(fixture.orderId, null, 'CI duplicate'), 'ALREADY_CANCELLED')
    const [order, product] = await Promise.all([
      prisma.order.findUnique({ where: { id: fixture.orderId }, select: { status: true } }),
      prisma.product.findUnique({ where: { id: fixture.productId }, select: { stock: true } }),
    ])
    assert.equal(order?.status, 'CANCELLED')
    assert.equal(product?.stock, 2)
  } finally {
    await cleanupFixture(fixture)
  }
})


test('un despacho admitido bloquea cancelación y reposición aunque el estado siga en preparación', { skip: !databaseAvailable }, async () => {
  const fixture = await createRefundFixture('PREPARING')
  try {
    await prisma.cancellationRequest.update({
      where: { orderId: fixture.orderId },
      data: { returnStatus: 'RETURN_PENDING' },
    })
    assert.equal(await finalizePreDispatchRefund(fixture.orderId, null, 'CI admitted shipment'), 'RETURN_WORKFLOW_REQUIRED')
    const [order, product] = await Promise.all([
      prisma.order.findUnique({ where: { id: fixture.orderId }, select: { status: true } }),
      prisma.product.findUnique({ where: { id: fixture.productId }, select: { stock: true } }),
    ])
    assert.equal(order?.status, 'PREPARING')
    assert.equal(product?.stock, 0)
  } finally {
    await cleanupFixture(fixture)
  }
})

test('un pedido ya despachado no se cancela ni repone stock automáticamente: requiere devolución física', { skip: !databaseAvailable }, async () => {
  const fixture = await createRefundFixture('SHIPPED')
  try {
    assert.equal(await finalizePreDispatchRefund(fixture.orderId, null, 'CI shipped refund'), 'RETURN_WORKFLOW_REQUIRED')
    const [order, product] = await Promise.all([
      prisma.order.findUnique({ where: { id: fixture.orderId }, select: { status: true } }),
      prisma.product.findUnique({ where: { id: fixture.productId }, select: { stock: true } }),
    ])
    assert.equal(order?.status, 'SHIPPED')
    assert.equal(product?.stock, 0)
  } finally {
    await cleanupFixture(fixture)
  }
})

test('una devolución física inspeccionada repone stock una sola vez', { skip: !databaseAvailable }, async () => {
  const fixture = await createRefundFixture('SHIPPED')
  try {
    await prisma.cancellationRequest.update({
      where: { orderId: fixture.orderId },
      data: { returnStatus: 'RETURN_RECEIVED' },
    })
    assert.equal(await acceptReturnedOrderStock(fixture.orderId, null), 'RETURN_ACCEPTED')
    assert.equal(await acceptReturnedOrderStock(fixture.orderId, null), 'ALREADY_ACCEPTED')
    const product = await prisma.product.findUnique({ where: { id: fixture.productId }, select: { stock: true } })
    assert.equal(product?.stock, 2)
  } finally {
    await cleanupFixture(fixture)
  }
})
