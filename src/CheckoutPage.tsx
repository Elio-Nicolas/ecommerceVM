import { useEffect, useState, type FormEvent } from 'react'
import { formatPrice, type Product } from './products'
import './checkout.css'

type CartLine = { product: Product; quantity: number }
type ShippingOption = {
  key: string
  carrierName: string
  carrierId: string | null
  serviceCode: string
  serviceLabel: string
  priceArs: number
  estimatedHours: number | null
}
type ShippingQuote = {
  id: string
  subtotalArs: number
  options: ShippingOption[]
  expiresAt: string
}
type CreatedOrder = {
  code: string
  subtotalArs: number
  shippingCostArs: number
  totalArs: number
  shippingCarrier: string | null
  shippingService: string | null
}
type Props = {
  cart: CartLine[]
  subtotal: number
  onBack: () => void
  onFinish: () => void
  onOrderCreated: () => void
}

const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:7381').replace(/\/$/, '')
const PROVINCES = [
  ['A', 'Salta'], ['B', 'Buenos Aires'], ['C', 'Ciudad Autónoma de Buenos Aires'],
  ['D', 'San Luis'], ['E', 'Entre Ríos'], ['F', 'La Rioja'], ['G', 'Santiago del Estero'],
  ['H', 'Chaco'], ['J', 'San Juan'], ['K', 'Catamarca'], ['L', 'La Pampa'],
  ['M', 'Mendoza'], ['N', 'Misiones'], ['P', 'Formosa'], ['Q', 'Neuquén'],
  ['R', 'Río Negro'], ['S', 'Santa Fe'], ['T', 'Tucumán'], ['U', 'Chubut'],
  ['V', 'Tierra del Fuego'], ['W', 'Corrientes'], ['X', 'Córdoba'],
  ['Y', 'Jujuy'], ['Z', 'Santa Cruz'],
] as const

function deliveryEstimate(hours: number | null) {
  if (!hours) return 'Plazo a confirmar'
  if (hours < 24) return 'Aproximadamente 1 día'
  return `Aproximadamente ${Math.ceil(hours / 24)} días`
}

export default function CheckoutPage({ cart, subtotal, onBack, onFinish, onOrderCreated }: Props) {
  const [customerName, setCustomerName] = useState('')
  const [customerEmail, setCustomerEmail] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
  const [addressLine, setAddressLine] = useState('')
  const [city, setCity] = useState('')
  const [provinceCode, setProvinceCode] = useState('')
  const [postalCode, setPostalCode] = useState('')
  const [customerNotes, setCustomerNotes] = useState('')
  const [quote, setQuote] = useState<ShippingQuote | null>(null)
  const [selectedOptionKey, setSelectedOptionKey] = useState('')
  const [quoteLoading, setQuoteLoading] = useState(false)
  const [quoteError, setQuoteError] = useState('')
  const [quoteExpired, setQuoteExpired] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [createdOrder, setCreatedOrder] = useState<CreatedOrder | null>(null)

  const cartKey = cart.map((line) => `${line.product.id}:${line.quantity}`).sort().join('|')
  const selectedOption = quote?.options.find((option) => option.key === selectedOptionKey) || null
  const provinceName = PROVINCES.find(([code]) => code === provinceCode)?.[1] || ''
  const quoteExpired = quote ? new Date(quote.expiresAt).getTime() <= Date.now() : false

  useEffect(() => {
    setQuote(null)
    setSelectedOptionKey('')
    setQuoteError('')
    if (!provinceCode || !/^\d{4}$/.test(postalCode) || cart.length === 0) return

    const timeout = window.setTimeout(async () => {
      setQuoteLoading(true)
      try {
        const response = await fetch(`${API_URL}/api/v1/shipping/quotes`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            provinceCode,
            postalCode,
            items: cart.map((line) => ({ productId: line.product.id, quantity: line.quantity })),
          }),
        })
        const payload = await response.json() as {
          data?: ShippingQuote
          error?: { message?: string }
        }
        if (!response.ok || !payload.data) {
          throw new Error(payload.error?.message || 'No pudimos calcular el envío.')
        }
        if (!controller.signal.aborted) setQuote(payload.data)
      } catch (cause) {
        if (!controller.signal.aborted) setQuoteError(cause instanceof Error ? cause.message : 'No pudimos calcular el envío.')
      } finally {
        if (!controller.signal.aborted) setQuoteLoading(false)
      }
    }, 500)

    return () => { window.clearTimeout(timeout); controller.abort() }
  }, [provinceCode, postalCode, cartKey])

  async function submitOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting || cart.length === 0 || !quote || !selectedOption || quoteExpired) return
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
          province: provinceName,
          provinceCode,
          postalCode,
          customerNotes,
          shippingQuoteId: quote.id,
          shippingOptionKey: selectedOption.key,
          items: cart.map((line) => ({ productId: line.product.id, quantity: line.quantity })),
        }),
      })
      const payload = await response.json() as {
        data?: CreatedOrder
        error?: { message?: string }
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
          <p>Recibimos tu pedido con el costo de envío calculado. El pago todavía no está habilitado.</p>
          <div className="checkout-order-code">
            <span>CÓDIGO DE PEDIDO</span>
            <strong>{createdOrder.code}</strong>
          </div>
          <div className="checkout-success-total"><span>Productos</span><strong>{formatPrice(createdOrder.subtotalArs)}</strong></div>
          <div className="checkout-success-total"><span>Envío</span><strong>{formatPrice(createdOrder.shippingCostArs)}</strong></div>
          <div className="checkout-success-total"><span>Total</span><strong>{formatPrice(createdOrder.totalArs)}</strong></div>
          <p className="checkout-small">Este pedido quedó registrado, pero todavía no fue cobrado.</p>
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
        <p>Calculamos el envío con Envíopack según el destino y los paquetes. No se realizará ningún cobro en esta instancia.</p>
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
              <label>Provincia
                <select required value={provinceCode} onChange={(event) => setProvinceCode(event.target.value)}>
                  <option value="">Seleccionar provincia</option>
                  {PROVINCES.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
                </select>
              </label>
              <label>Código postal<input required maxLength={4} minLength={4} inputMode="numeric" pattern="\d{4}" autoComplete="postal-code" value={postalCode} onChange={(event) => setPostalCode(event.target.value.replace(/\D/g, '').slice(0, 4))} /></label>
              <label className="checkout-field-full">Indicaciones adicionales <span>(opcional)</span><textarea maxLength={1000} rows={3} value={customerNotes} onChange={(event) => setCustomerNotes(event.target.value)} placeholder="Piso, departamento, referencias para la entrega..." /></label>
            </div>
          </section>
          <section className="checkout-card">
            <h2>Opciones de envío</h2>
            {!provinceCode || !/^\d{4}$/.test(postalCode)
              ? <p className="checkout-shipping-hint">Ingresá provincia y código postal para calcular el envío.</p>
              : quoteLoading
                ? <p className="checkout-shipping-hint">Consultando tarifas de Envíopack...</p>
                : quoteError
                  ? <div className="checkout-error" role="alert">{quoteError}</div>
                  : quote?.options.length
                    ? <div className="checkout-shipping-options">
                        {quote.options.map((option) => (
                          <label className={selectedOptionKey === option.key ? 'checkout-shipping-option selected' : 'checkout-shipping-option'} key={option.key}>
                            <input type="radio" name="shippingOption" value={option.key} checked={selectedOptionKey === option.key} onChange={() => setSelectedOptionKey(option.key)} />
                            <span className="checkout-shipping-option-copy">
                              <strong>{option.carrierName} · {option.serviceLabel}</strong>
                              <small>{deliveryEstimate(option.estimatedHours)}</small>
                            </span>
                            <strong className="checkout-shipping-price">{formatPrice(option.priceArs)}</strong>
                          </label>
                        ))}
                        <p className="checkout-shipping-expiry">La cotización tiene una validez de 10 minutos.</p>
                      </div>
                    : quote ? <p className="checkout-shipping-hint">No hay servicios disponibles para este destino.</p>
                    : <p className="checkout-shipping-hint">El costo se calculará automáticamente al completar el destino.</p>}
          </section>
          {error && <div className="checkout-error" role="alert">{error}</div>}
          <button className="checkout-submit" type="submit" disabled={submitting || cart.length === 0 || !selectedOption || quoteExpired}>
            {submitting ? 'Registrando pedido...' : 'Confirmar pedido'}
          </button>
          <p className="checkout-disclaimer">El pedido se registra únicamente después de seleccionar una cotización válida. El pago se incorporará en la siguiente etapa.</p>
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
          <div className="checkout-summary-total"><span>Subtotal</span><strong>{formatPrice(displayedSubtotal)}</strong></div>
          <div className="checkout-summary-total"><span>Envío</span><strong>{selectedOption ? formatPrice(selectedOption.priceArs) : 'A calcular'}</strong></div>
          <div className="checkout-summary-grand-total"><span>Total</span><strong>{formatPrice(displayedSubtotal + (selectedOption?.priceArs || 0))}</strong></div>
          <p className="checkout-summary-note">El importe del envío se obtiene de Envíopack. El total queda confirmado al registrar el pedido.</p>
        </aside>
      </div>
    </main>
  )
}
