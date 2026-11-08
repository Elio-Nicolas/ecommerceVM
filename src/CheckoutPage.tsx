import { useState, type FormEvent } from 'react'
import { formatPrice, type Product } from './products'
import './checkout.css'

type CartLine = { product: Product; quantity: number }
type CreatedOrder = { code: string; subtotalArs: number; status: string }
type Props = {
  cart: CartLine[]
  subtotal: number
  onBack: () => void
  onFinish: () => void
  onOrderCreated: () => void
}

const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:7381').replace(/\/$/, '')

export default function CheckoutPage({ cart, subtotal, onBack, onFinish, onOrderCreated }: Props) {
  const [customerName, setCustomerName] = useState('')
  const [customerEmail, setCustomerEmail] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
  const [addressLine, setAddressLine] = useState('')
  const [city, setCity] = useState('')
  const [province, setProvince] = useState('')
  const [postalCode, setPostalCode] = useState('')
  const [customerNotes, setCustomerNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [createdOrder, setCreatedOrder] = useState<CreatedOrder | null>(null)

  async function submitOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting || cart.length === 0) return
    setSubmitting(true)
    setError('')
    try {
      const response = await fetch(`${API_URL}/api/v1/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerName,
          customerEmail,
          customerPhone,
          addressLine,
          city,
          province,
          postalCode,
          customerNotes,
          items: cart.map((line) => ({ productId: line.product.id, quantity: line.quantity })),
        }),
      })
      const payload = await response.json() as {
        data?: CreatedOrder
        error?: { message?: string }
        message?: string
      }
      if (!response.ok || !payload.data) {
        throw new Error(payload.error?.message || 'No pudimos registrar el pedido. Revisá los datos e intentá nuevamente.')
      }
      setCreatedOrder(payload.data)
      onOrderCreated()
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Ocurrió un error al enviar el pedido.')
    } finally {
      setSubmitting(false)
    }
  }

  if (createdOrder) {
    return (
      <main className="checkout-page">
        <section className="checkout-success">
          <div className="checkout-success-mark">✓</div>
          <span className="checkout-eyebrow">PEDIDO REGISTRADO</span>
          <h1>¡Gracias por tu pedido!</h1>
          <p>Recibimos tu solicitud. Nuestro equipo revisará la disponibilidad y se pondrá en contacto para confirmar el envío y el importe final.</p>
          <div className="checkout-order-code">
            <span>CÓDIGO DE PEDIDO</span>
            <strong>{createdOrder.code}</strong>
          </div>
          <div className="checkout-success-total"><span>Subtotal de productos</span><strong>{formatPrice(createdOrder.subtotalArs)}</strong></div>
          <p className="checkout-small">El envío y el total final quedan sujetos a confirmación. Este pedido todavía no está pagado.</p>
          <button className="checkout-submit" onClick={onFinish}>Volver a la tienda</button>
        </section>
      </main>
    )
  }

  return (
    <main className="checkout-page">
      <div className="checkout-top">
        <button type="button" className="checkout-back" onClick={onBack}>← Volver al carrito</button>
        <span className="checkout-eyebrow">FINALIZAR PEDIDO</span>
        <h1>Un último paso.</h1>
        <p>Dejanos tus datos para coordinar la entrega. No se realizará ningún cobro en esta instancia.</p>
      </div>
      <div className="checkout-layout">
        <form className="checkout-form" onSubmit={submitOrder}>
          <section className="checkout-card">
            <h2>Datos de contacto</h2>
            <div className="checkout-fields">
              <label>Nombre y apellido<input required minLength={2} maxLength={120} autoComplete="name" value={customerName} onChange={(event) => setCustomerName(event.target.value)} /></label>
              <label>Teléfono / WhatsApp<input required type="tel" minLength={8} maxLength={30} autoComplete="tel" placeholder="Ej. 2657 123456" value={customerPhone} onChange={(event) => setCustomerPhone(event.target.value)} /></label>
              <label className="checkout-field-full">Correo electrónico <span>(opcional)</span><input type="email" maxLength={160} autoComplete="email" value={customerEmail} onChange={(event) => setCustomerEmail(event.target.value)} /></label>
            </div>
          </section>
          <section className="checkout-card">
            <h2>Dirección de entrega</h2>
            <div className="checkout-fields">
              <label className="checkout-field-full">Calle y altura<input required minLength={4} maxLength={180} autoComplete="street-address" value={addressLine} onChange={(event) => setAddressLine(event.target.value)} /></label>
              <label>Localidad<input required minLength={2} maxLength={100} autoComplete="address-level2" value={city} onChange={(event) => setCity(event.target.value)} /></label>
              <label>Provincia<input required minLength={2} maxLength={100} autoComplete="address-level1" value={province} onChange={(event) => setProvince(event.target.value)} /></label>
              <label>Código postal <span>(opcional)</span><input maxLength={20} autoComplete="postal-code" value={postalCode} onChange={(event) => setPostalCode(event.target.value)} /></label>
              <label className="checkout-field-full">Indicaciones adicionales <span>(opcional)</span><textarea maxLength={1000} rows={3} value={customerNotes} onChange={(event) => setCustomerNotes(event.target.value)} placeholder="Piso, departamento, referencias para la entrega..." /></label>
            </div>
          </section>
          {error && <div className="checkout-error" role="alert">{error}</div>}
          <button className="checkout-submit" type="submit" disabled={submitting || cart.length === 0}>{submitting ? 'Registrando pedido...' : 'Confirmar pedido'}</button>
          <p className="checkout-disclaimer">Al confirmar, reservaremos el stock de los productos. El equipo se comunicará para confirmar envío y pago.</p>
        </form>
        <aside className="checkout-summary">
          <h2>Tu pedido</h2>
          <div className="checkout-summary-lines">
            {cart.map((line) => (
              <div className="checkout-summary-line" key={line.product.id}>
                <div><strong>{line.product.name}</strong><span>{line.quantity} × {formatPrice(line.product.price)}</span></div>
                <strong>{formatPrice(line.product.price * line.quantity)}</strong>
              </div>
            ))}
          </div>
          <div className="checkout-summary-total"><span>Subtotal</span><strong>{formatPrice(subtotal)}</strong></div>
          <p>Envío: a coordinar</p>
          <p className="checkout-summary-note">El total definitivo se informa cuando confirmemos el costo de envío. No se solicita información de pago.</p>
        </aside>
      </div>
    </main>
  )
}
