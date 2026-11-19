import { env } from '../config/env'

type ReceiptOrder = {
  id: string
  code: string
  customerName: string
  customerEmail: string
  addressLine: string
  city: string
  province: string
  postalCode: string | null
  paymentMethod: string
  status: string
  subtotalArs: number
  shippingCostArs: number | null
  totalArs: number | null
  paymentSurchargeArs: number
  shippingCarrier: string | null
  items: Array<{
    productName: string
    productSku: string
    quantity: number
    unitPriceArs: number
    lineTotalArs: number
  }>
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character]!)
}

function money(value: number) {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 0,
  }).format(value)
}

function paymentLabel(method: string) {
  if (method === 'MERCADO_PAGO') return 'Pago online iniciado; pendiente de confirmación de Mercado Pago.'
  if (method === 'GOCUOTAS') return 'Pago iniciado; pendiente de confirmación de GOcuotas.'
  return 'Pago a coordinar con la tienda.'
}

export async function sendOrderReceiptEmail(order: ReceiptOrder) {
  if (!env.RESEND_API_KEY || !env.ORDER_EMAIL_FROM) {
    console.warn('[order-email] No se envió el comprobante: faltan RESEND_API_KEY u ORDER_EMAIL_FROM.')
    return
  }

  const appUrl = (env.PUBLIC_APP_URL || 'https://tienda.iored.com.ar').replace(/\\/+$/, '')
  const regretUrl = appUrl + '/arrepentimiento'
  const rows = order.items.map((item) => `
    <tr>
      <td style="padding:12px 8px;border-bottom:1px solid #e2e8f0">
        <strong>${escapeHtml(item.productName)}</strong><br>
        <span style="color:#64748b;font-size:12px">SKU: ${escapeHtml(item.productSku)} · Cantidad: ${item.quantity}</span>
      </td>
      <td style="padding:12px 8px;border-bottom:1px solid #e2e8f0;text-align:right;white-space:nowrap">${money(item.lineTotalArs)}</td>
    </tr>`).join('')
  const shipping = order.shippingCostArs === null ? 'A coordinar' : money(order.shippingCostArs)
  const total = order.totalArs === null ? 'A confirmar' : money(order.totalArs)
  const shippingAddress = [order.addressLine, order.city, order.province, order.postalCode].filter(Boolean).join(', ')
  const subject = 'Recibimos tu pedido ' + order.code + ' · Tu TiendaVM'
  const html = `
  <div style="margin:0;background:#f8fafc;padding:32px 12px;font-family:Arial,Helvetica,sans-serif;color:#0f172a">
    <div style="max-width:620px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:16px;overflow:hidden">
      <div style="background:#0a2540;padding:28px 32px;color:#fff">
        <div style="font-size:12px;letter-spacing:2px;font-weight:bold;color:#cbd5e1">TU TIENDAVM</div>
        <h1 style="font-size:25px;margin:12px 0 4px">¡Gracias por tu compra!</h1>
        <p style="margin:0;color:#dbeafe">Recibimos tu pedido y te dejamos el comprobante.</p>
      </div>
      <div style="padding:28px 32px">
        <p>Hola ${escapeHtml(order.customerName)},</p>
        <p>Guardá este correo: contiene el código que vas a necesitar para consultar tu compra o iniciar una solicitud de arrepentimiento.</p>
        <div style="background:#f1f5f9;border-radius:12px;padding:18px;margin:22px 0;text-align:center">
          <div style="font-size:11px;letter-spacing:1.5px;color:#64748b;font-weight:bold">CÓDIGO DE PEDIDO</div>
          <div style="font-size:24px;font-weight:bold;letter-spacing:1px;margin-top:8px;color:#0a2540">${escapeHtml(order.code)}</div>
        </div>
        <h2 style="font-size:17px;margin:26px 0 10px">Detalle de la compra</h2>
        <table role="presentation" style="width:100%;border-collapse:collapse;font-size:14px">
          ${rows}
          <tr><td style="padding:10px 8px;color:#475569">Subtotal</td><td style="padding:10px 8px;text-align:right">${money(order.subtotalArs)}</td></tr>
          <tr><td style="padding:10px 8px;color:#475569">Envío · ${escapeHtml(order.shippingCarrier || 'Entrega')}</td><td style="padding:10px 8px;text-align:right">${shipping}</td></tr>
          <tr><td style="padding:10px 8px;color:#475569">Recargo por medio de pago</td><td style="padding:10px 8px;text-align:right">${money(order.paymentSurchargeArs)}</td></tr>
          <tr><td style="padding:14px 8px;font-weight:bold;border-top:1px solid #cbd5e1">Total</td><td style="padding:14px 8px;text-align:right;font-weight:bold;border-top:1px solid #cbd5e1">${total}</td></tr>
        </table>
        <h2 style="font-size:17px;margin:26px 0 8px">Estado del pago</h2>
        <p style="margin:0;color:#475569;line-height:1.6">${paymentLabel(order.paymentMethod)}</p>
        <h2 style="font-size:17px;margin:26px 0 8px">Entrega</h2>
        <p style="margin:0;color:#475569;line-height:1.6">${escapeHtml(shippingAddress)}</p>
        <div style="margin:28px 0;text-align:center">
          <a href="${regretUrl}" style="display:inline-block;background:#0a2540;color:#fff;text-decoration:none;font-weight:bold;padding:14px 22px;border-radius:9px">Botón de arrepentimiento</a>
        </div>
        <p style="font-size:12px;line-height:1.6;color:#64748b">Para enviar una solicitud, ingresá el código de pedido de este correo y el mismo email con el que realizaste la compra. La solicitud será revisada por la tienda; este formulario no ejecuta un reembolso automático.</p>
      </div>
      <div style="padding:18px 32px;background:#f8fafc;color:#64748b;font-size:12px">Tu TiendaVM · Villa Mercedes, San Luis</div>
    </div>
  </div>`

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + env.RESEND_API_KEY,
        'Content-Type': 'application/json',
        'Idempotency-Key': 'order-receipt/' + order.id,
      },
      body: JSON.stringify({
        from: env.ORDER_EMAIL_FROM,
        to: [order.customerEmail],
        subject,
        html,
        text: [
          'TU TIENDAVM',
          'Recibimos tu pedido ' + order.code,
          'Código de pedido: ' + order.code,
          ...order.items.map((item) => item.productName + ' x' + item.quantity + ' - ' + money(item.lineTotalArs)),
          'Subtotal: ' + money(order.subtotalArs),
          'Envío: ' + shipping,
          'Recargo: ' + money(order.paymentSurchargeArs),
          'Total: ' + total,
          'Estado: ' + paymentLabel(order.paymentMethod),
          'Entrega: ' + shippingAddress,
          'Arrepentimiento: ' + regretUrl,
          'Para solicitarlo, ingresá el código y el correo usado en la compra.',
        ].join('\\n'),
      }),
      signal: AbortSignal.timeout(12000),
    })
    if (!response.ok) {
      const details = await response.text().catch(() => '')
      console.error('[order-email] Resend rechazó el comprobante:', response.status, details.slice(0, 500))
      return
    }
    const payload = await response.json().catch(() => ({})) as { id?: string }
    console.info('[order-email] Comprobante enviado:', order.code, payload.id || '(sin id)')
  } catch (error) {
    console.error('[order-email] No se pudo enviar el comprobante:', error instanceof Error ? error.message : 'Error desconocido')
  }
}
