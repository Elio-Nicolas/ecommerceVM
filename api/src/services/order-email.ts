import { env } from '../config/env'
import { prisma } from '../lib/prisma'

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]!)
}

function money(value: number) {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(value)
}

/**
 * Sends exactly one paid confirmation per order. The database claim prevents
 * duplicate webhook deliveries and concurrent status refreshes from sending
 * multiple messages. A failed Resend request releases the claim for retry.
 */
export async function sendPaidOrderConfirmationEmail(orderId: string) {
  if (!env.RESEND_API_KEY || !env.ORDER_EMAIL_FROM) {
    console.warn('[order-email] No se envió la confirmación: faltan RESEND_API_KEY u ORDER_EMAIL_FROM.')
    return false
  }

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { items: true, paymentAttempts: { where: { status: 'APPROVED' }, select: { id: true }, take: 1 } },
  })
  if (!order || !order.customerEmail || order.status === 'CANCELLED') return false
  const isManuallyReceived = Boolean(order.paymentReceivedAt)
  if (!isManuallyReceived && (order.status !== 'CONFIRMED' || order.paymentAttempts.length === 0)) return false

  const claimedAt = new Date()
  const claim = await prisma.order.updateMany({
    where: { id: order.id, status: { not: 'CANCELLED' }, receiptEmailSentAt: null },
    data: { receiptEmailSentAt: claimedAt },
  })
  if (claim.count !== 1) return false

  const appUrl = new URL(env.PUBLIC_APP_URL || 'https://tienda.iored.com.ar').origin
  const regretUrl = appUrl + '/arrepentimiento'
  const rows = order.items.map((item) => `
    <tr><td style="padding:12px 8px;border-bottom:1px solid #e2e8f0"><strong>${escapeHtml(item.productName)}</strong><br><span style="color:#64748b;font-size:12px">SKU: ${escapeHtml(item.productSku)} · Cantidad: ${item.quantity}</span></td>
    <td style="padding:12px 8px;border-bottom:1px solid #e2e8f0;text-align:right;white-space:nowrap">${money(item.lineTotalArs)}</td></tr>`).join('')
  const shipping = order.shippingCostArs === null ? 'A coordinar' : money(order.shippingCostArs)
  const total = order.totalArs === null ? 'A confirmar' : money(order.totalArs)
  const address = [order.addressLine, order.city, order.province, order.postalCode].filter(Boolean).join(', ')
  const subject = 'Pago confirmado · Pedido ' + order.code + ' · Tu TiendaVM'
  const html = `
  <div style="margin:0;background:#f8fafc;padding:32px 12px;font-family:Arial,Helvetica,sans-serif;color:#0f172a"><div style="max-width:620px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:16px;overflow:hidden">
  <div style="background:#0a2540;padding:28px 32px;color:#fff"><div style="font-size:12px;letter-spacing:2px;font-weight:bold;color:#cbd5e1">TU TIENDAVM</div><h1 style="font-size:25px;margin:12px 0 4px">¡Pago confirmado!</h1><p style="margin:0;color:#dbeafe">Recibimos la confirmación de tu pago.</p></div>
  <div style="padding:28px 32px"><p>Hola ${escapeHtml(order.customerName)},</p><p>Tu pago fue registrado correctamente. Guardá este correo: contiene el código para consultar tu pedido o iniciar una solicitud de arrepentimiento.</p>
  <div style="background:#f1f5f9;border-radius:12px;padding:18px;margin:22px 0;text-align:center"><div style="font-size:11px;letter-spacing:1.5px;color:#64748b;font-weight:bold">CÓDIGO DE PEDIDO</div><div style="font-size:24px;font-weight:bold;letter-spacing:1px;margin-top:8px;color:#0a2540">${escapeHtml(order.code)}</div></div>
  <h2 style="font-size:17px;margin:26px 0 10px">Detalle de la compra</h2><table role="presentation" style="width:100%;border-collapse:collapse;font-size:14px">${rows}
  <tr><td style="padding:10px 8px;color:#475569">Subtotal</td><td style="padding:10px 8px;text-align:right">${money(order.subtotalArs)}</td></tr>
  <tr><td style="padding:10px 8px;color:#475569">Envío · ${escapeHtml(order.shippingCarrier || 'Entrega')}</td><td style="padding:10px 8px;text-align:right">${shipping}</td></tr>
  <tr><td style="padding:10px 8px;color:#475569">Recargo por medio de pago</td><td style="padding:10px 8px;text-align:right">${money(order.paymentSurchargeArs)}</td></tr>
  <tr><td style="padding:14px 8px;font-weight:bold;border-top:1px solid #cbd5e1">Total</td><td style="padding:14px 8px;text-align:right;font-weight:bold;border-top:1px solid #cbd5e1">${total}</td></tr></table>
  <h2 style="font-size:17px;margin:26px 0 8px">Estado del pago</h2><p style="margin:0;color:#475569;line-height:1.6">Pago acreditado${isManuallyReceived ? ' y registrado por la tienda' : ' por ' + (order.paymentMethod === 'GOCUOTAS' ? 'GOcuotas' : 'Mercado Pago')}.</p>
  <h2 style="font-size:17px;margin:26px 0 8px">Entrega</h2><p style="margin:0;color:#475569;line-height:1.6">${escapeHtml(address)}</p>
  <div style="margin:28px 0;text-align:center"><a href="${regretUrl}" style="display:inline-block;background:#0a2540;color:#fff;text-decoration:none;font-weight:bold;padding:14px 22px;border-radius:9px">Botón de arrepentimiento</a></div>
  <p style="font-size:12px;line-height:1.6;color:#64748b">Para enviar una solicitud, ingresá el código de pedido de este correo y el mismo email con el que realizaste la compra. La solicitud será revisada por la tienda; este formulario no ejecuta un reembolso automático.</p></div>
  <div style="padding:18px 32px;background:#f8fafc;color:#64748b;font-size:12px">Tu TiendaVM · Villa Mercedes, San Luis</div></div></div>`

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + env.RESEND_API_KEY, 'Content-Type': 'application/json', 'Idempotency-Key': 'order-paid-confirmation/' + order.id },
      body: JSON.stringify({
        from: env.ORDER_EMAIL_FROM, to: [order.customerEmail], subject, html,
        text: [
          'TU TIENDAVM', '¡Pago confirmado!', 'Tu pago fue registrado correctamente.',
          'Código de pedido: ' + order.code,
          ...order.items.map((item) => item.productName + ' x' + item.quantity + ' - ' + money(item.lineTotalArs)),
          'Subtotal: ' + money(order.subtotalArs), 'Envío: ' + shipping,
          'Recargo: ' + money(order.paymentSurchargeArs), 'Total: ' + total,
          'Estado: Pago acreditado', 'Entrega: ' + address, 'Arrepentimiento: ' + regretUrl,
        ].join('\n'),
      }),
      signal: AbortSignal.timeout(12000),
    })
    if (!response.ok) {
      const details = await response.text().catch(() => '')
      console.error('[order-email] Resend rechazó la confirmación:', response.status, details.slice(0, 500))
      await prisma.order.updateMany({ where: { id: order.id, receiptEmailSentAt: claimedAt }, data: { receiptEmailSentAt: null } })
      return false
    }
    const payload = await response.json().catch(() => ({})) as { id?: string }
    console.info('[order-email] Confirmación de pago enviada:', order.code, payload.id || '(sin id)')
    return true
  } catch (error) {
    console.error('[order-email] No se pudo enviar la confirmación:', error instanceof Error ? error.message : 'Error desconocido')
    await prisma.order.updateMany({ where: { id: order.id, receiptEmailSentAt: claimedAt }, data: { receiptEmailSentAt: null } })
    return false
  }
}
