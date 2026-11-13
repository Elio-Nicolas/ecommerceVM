import { useEffect, useRef, useState, type FormEvent } from 'react'
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
type DeliveryMethod = 'OCA' | 'LOCAL_DELIVERY' | 'PICKUP'
type DeliveryMethods = {
  pickup: { enabled: boolean; address: string; instructions: string; priceArs: number }
  localDelivery: { enabled: boolean; postalCodes: string[]; priceArs: number | null; coordinate: boolean }
  oca: { enabled: boolean }
}
type ShippingQuote = {
  id: string
  subtotalArs: number
  options: ShippingOption[]
  expiresAt: string
}
type CreatedOrder = {
  id: string
  code: string
  subtotalArs: number
  shippingCostArs: number | null
  totalArs: number | null
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
  const [deliveryMethods, setDeliveryMethods] = useState<DeliveryMethods | null>(null)
  const [deliveryMethod, setDeliveryMethod] = useState<DeliveryMethod | ''>('')
  const [quote, setQuote] = useState<ShippingQuote | null>(null)
  const [selectedOptionKey, setSelectedOptionKey] = useState('')
  const [quoteLoading, setQuoteLoading] = useState(false)
  const [quoteError, setQuoteError] = useState('')
  const [quoteExpired, setQuoteExpired] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [createdOrder, setCreatedOrder] = useState<CreatedOrder | null>(null)
  const [coverageNoticeOpen, setCoverageNoticeOpen] = useState(false)
  const [paymentsEnabled, setPaymentsEnabled] = useState(false)
  const [paymentsConfigLoaded, setPaymentsConfigLoaded] = useState(false)
  const [paymentLoading, setPaymentLoading] = useState(false)
  const [paymentError, setPaymentError] = useState('')

  const cartKey = cart.map((line) => `${line.product.id}:${line.quantity}`).sort().join('|')
  const checkoutStorageKey = `ecommercevm:checkout-request:${cartKey}`
  const checkoutRequestKey = useRef<string | null>(null)
  if (!checkoutRequestKey.current) {
    try {
      const savedKey = sessionStorage.getItem(checkoutStorageKey)
      checkoutRequestKey.current = savedKey && /^[0-9a-f-]{36}$/i.test(savedKey) ? savedKey : crypto.randomUUID()
      sessionStorage.setItem(checkoutStorageKey, checkoutRequestKey.current)
    } catch {
      checkoutRequestKey.current = crypto.randomUUID()
    }
  }
  const selectedOption = quote?.options.find((option) => option.key === selectedOptionKey) || null
  const provinceName = PROVINCES.find(([code]) => code === provinceCode)?.[1] || ''
  const displayedSubtotal = quote?.subtotalArs ?? subtotal
  const localDeliveryAvailable = Boolean(deliveryMethods?.localDelivery.enabled && deliveryMethods.localDelivery.postalCodes.includes(postalCode))
  const selectedShippingPrice = deliveryMethod === 'PICKUP' ? 0 : deliveryMethod === 'LOCAL_DELIVERY' ? (deliveryMethods?.localDelivery.priceArs ?? 0) : (selectedOption?.priceArs ?? 0)
  const canSubmit = deliveryMethod === 'PICKUP' ? Boolean(deliveryMethods?.pickup.enabled) : deliveryMethod === 'LOCAL_DELIVERY' ? localDeliveryAvailable : Boolean(quote && selectedOption && !quoteExpired)

  useEffect(() => {
    if (!createdOrder || createdOrder.shippingCostArs !== null) return
    const controller = new AbortController()
    const refreshReceipt = async () => {
      try {
        const response = await fetch(`${API_URL}/api/v1/orders/${encodeURIComponent(createdOrder.id)}/receipt`, {
          cache: 'no-store',
          signal: controller.signal,
        })
        if (!response.ok) return
        const payload = await response.json() as {
          data?: { shippingCostArs: number | null; totalArs: number | null }
        }
        if (payload.data && payload.data.shippingCostArs !== null) {
          setCreatedOrder((current) => current ? {
            ...current,
            shippingCostArs: payload.data!.shippingCostArs,
            totalArs: payload.data!.totalArs,
          } : current)
        }
      } catch {
        // Se reintenta mientras el comprobante siga abierto.
      }
    }
    const interval = window.setInterval(() => void refreshReceipt(), 5000)
    return () => {
      window.clearInterval(interval)
      controller.abort()
    }
  }, [createdOrder?.id, createdOrder?.shippingCostArs])

  useEffect(() => {
    if (deliveryMethod === 'LOCAL_DELIVERY' && /^\d{4}$/.test(postalCode) && deliveryMethods?.localDelivery.enabled && !localDeliveryAvailable) {
      setCoverageNoticeOpen(true)
    } else {
      setCoverageNoticeOpen(false)
    }
  }, [deliveryMethod, postalCode, deliveryMethods, localDeliveryAvailable])

  useEffect(() => {
    fetch(`${API_URL}/api/v1/payments/config`)
      .then((response) => response.json())
      .then((payload) => setPaymentsEnabled(Boolean(payload.data?.enabled)))
      .catch(() => setPaymentsEnabled(false))
      .finally(() => setPaymentsConfigLoaded(true))
  }, [])

  useEffect(() => {
    fetch(`${API_URL}/api/v1/shipping/methods`).then((response) => response.json()).then((payload) => {
      const methods = payload.data as DeliveryMethods
      setDeliveryMethods(methods)
    }).catch(() => setDeliveryMethods(null))
  }, [])

  useEffect(() => {
    if (!quote) {
      setQuoteExpired(false)
      return
    }
    const remaining = new Date(quote.expiresAt).getTime() - Date.now()
    if (remaining <= 0) {
      setQuoteExpired(true)
      return
    }
    const expiryTimer = window.setTimeout(() => setQuoteExpired(true), remaining)
    return () => window.clearTimeout(expiryTimer)
  }, [quote])

  useEffect(() => {
    const controller = new AbortController()
    setQuote(null)
    setSelectedOptionKey('')
    setQuoteError('')
    setQuoteLoading(false)
    if (!deliveryMethods?.oca.enabled || deliveryMethod !== 'OCA' || !provinceCode || !/^\d{4}$/.test(postalCode) || cart.length === 0) {
      return () => controller.abort()
    }

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
  }, [provinceCode, postalCode, cartKey, deliveryMethod, deliveryMethods])

  async function startPayment(orderId: string) {
    if (paymentLoading) return
    setPaymentLoading(true)
    setPaymentError('')
    const storageKey = `ecommercevm:payment-request:${orderId}`
    try {
      let requestKey = ''
      try {
        requestKey = sessionStorage.getItem(storageKey) || ''
        if (!/^[0-9a-f-]{36}$/i.test(requestKey)) {
          requestKey = crypto.randomUUID()
          sessionStorage.setItem(storageKey, requestKey)
        }
      } catch {
        requestKey = crypto.randomUUID()
      }
      const response = await fetch(`${API_URL}/api/v1/payments/orders/${encodeURIComponent(orderId)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestKey }),
      })
      const payload = await response.json() as {
        data?: { checkoutUrl?: string }
        error?: { code?: string; message?: string }
      }
      if (!response.ok || !payload.data?.checkoutUrl) {
        if (payload.error?.code === 'ATTEMPT_CLOSED') {
          try { sessionStorage.removeItem(storageKey) } catch { /* El próximo intento generará una clave nueva. */ }
        }
        throw new Error(payload.error?.message || 'No pudimos iniciar el pago con Mercado Pago.')
      }
      window.location.assign(payload.data.checkoutUrl)
    } catch (cause) {
      setPaymentError(cause instanceof Error ? cause.message : 'No pudimos iniciar el pago.')
    } finally {
      setPaymentLoading(false)
    }
  }

  async function submitOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting || cart.length === 0 || !canSubmit) return
    setSubmitting(true)
    setError('')
    try {
      const response = await fetch(`${API_URL}/api/v1/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          checkoutRequestKey: checkoutRequestKey.current,
          customerName,
          customerEmail,
          customerPhone,
          addressLine: deliveryMethod === 'PICKUP' ? (deliveryMethods?.pickup.address || 'Domicilio del vendedor') : addressLine,
          city: deliveryMethod === 'PICKUP' ? 'Villa Mercedes' : city,
          province: deliveryMethod === 'PICKUP' ? 'San Luis' : provinceName,
          provinceCode: provinceCode || undefined,
          postalCode: deliveryMethod === 'PICKUP' ? '5730' : postalCode,
          customerNotes,
          deliveryMethod,
          ...(deliveryMethod === 'OCA' && quote && selectedOption ? { shippingQuoteId: quote.id, shippingOptionKey: selectedOption.key } : {}),
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
      try { sessionStorage.removeItem(checkoutStorageKey) } catch { /* El pedido ya quedó registrado; el almacenamiento es opcional. */ }
      setCreatedOrder(payload.data)
      onOrderCreated()
      if (paymentsEnabled && payload.data.totalArs !== null) await startPayment(payload.data.id)
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
          <p>{paymentsEnabled && createdOrder.totalArs !== null ? (paymentLoading ? 'Conectando con Mercado Pago para completar el pago...' : paymentError ? 'El pedido quedó registrado, pero todavía no pudimos iniciar el pago.' : 'Tu pedido quedó registrado. Te estamos redirigiendo a Mercado Pago.') : createdOrder.totalArs === null ? 'Tu pedido quedó registrado. Primero debemos confirmar el costo de entrega.' : 'Tu pedido quedó registrado. El pago se coordinará luego de confirmar el pedido.'}</p>
          <div className="checkout-order-code">
            <span>CÓDIGO DE PEDIDO</span>
            <strong>{createdOrder.code}</strong>
          </div>
          <div className="checkout-success-total"><span>Productos</span><strong>{formatPrice(createdOrder.subtotalArs)}</strong></div>
          <div className="checkout-success-total"><span>Envío</span><strong>{createdOrder.shippingCostArs === null ? 'A coordinar' : formatPrice(createdOrder.shippingCostArs)}</strong></div>
          <div className="checkout-success-total"><span>Total</span><strong>{createdOrder.totalArs === null ? 'A confirmar' : formatPrice(createdOrder.totalArs)}</strong></div>
          {createdOrder.shippingCostArs === null && <p className="checkout-small">Estamos esperando que se registre el costo acordado. El envío y el total se actualizarán automáticamente en este comprobante.</p>}
          {paymentError && <div className="checkout-error" role="alert">{paymentError}</div>}
          {paymentsEnabled && createdOrder.totalArs !== null && <button className="checkout-submit" onClick={() => void startPayment(createdOrder.id)} disabled={paymentLoading}>{paymentLoading ? 'Conectando...' : 'Pagar con Mercado Pago'}</button>}
          <p className="checkout-small">El pedido solo se confirma cuando Mercado Pago informa un pago aprobado y la API verifica su importe.</p>
          <button className="checkout-submit" onClick={onFinish}>Volver a la tienda</button>
        </section>
      </main>
    )
  }

  return (
    <main className="checkout-page">
      {coverageNoticeOpen && <div className="checkout-modal-backdrop" role="presentation" onClick={() => setCoverageNoticeOpen(false)}>
        <section className="checkout-modal" role="alertdialog" aria-modal="true" aria-labelledby="coverage-notice-title" onClick={(event) => event.stopPropagation()}>
          <div className="checkout-modal-icon" aria-hidden="true">!</div>
          <h2 id="coverage-notice-title">No llegamos a tu zona todavía</h2>
          <p>No realizamos entregas locales en este código postal. Podés elegir retiro por domicilio del vendedor u otro método de envío disponible.</p>
          <button type="button" className="checkout-submit" onClick={() => setCoverageNoticeOpen(false)}>Entendido</button>
        </section>
      </div>}
      <div className="checkout-top">
        <button type="button" className="checkout-back" onClick={onBack}>← Volver al carrito</button>
        <span className="checkout-eyebrow">FINALIZAR PEDIDO</span>
        <h1>Un último paso.</h1>
        <p>Elegí cómo querés recibir tu pedido. El costo y la disponibilidad dependen de la modalidad y del destino.</p>
      </div>
      <div className="checkout-layout">
        <form className="checkout-form" onSubmit={submitOrder}>
          <section className="checkout-card">
            <h2>Datos de contacto</h2>
            <div className="checkout-fields">
              <label>Nombre y apellido<input required minLength={2} maxLength={120} autoComplete="name" value={customerName} onChange={(event) => setCustomerName(event.target.value)} /></label>
              <label>Teléfono / WhatsApp<input required type="tel" minLength={8} maxLength={30} autoComplete="tel" placeholder="Ej. 2657 123456" value={customerPhone} onChange={(event) => setCustomerPhone(event.target.value)} /></label>
              <label className="checkout-field-full">Correo electrónico {deliveryMethod === 'OCA' || paymentsEnabled ? <span>(obligatorio para el envío y el pago)</span> : <span>(opcional)</span>}<input type="email" required={deliveryMethod === 'OCA' || paymentsEnabled} maxLength={deliveryMethod === 'OCA' || paymentsEnabled ? 100 : 160} autoComplete="email" value={customerEmail} onChange={(event) => setCustomerEmail(event.target.value)} /></label>
            </div>
          </section>
          <section className="checkout-card">
            <h2>Cómo querés recibir tu pedido</h2>
            {!deliveryMethods ? <p className="checkout-shipping-hint">Consultando modalidades disponibles...</p> : <div className="checkout-shipping-options">
              {deliveryMethods.pickup.enabled && <label className={deliveryMethod === 'PICKUP' ? 'checkout-shipping-option selected' : 'checkout-shipping-option'}>
                <input type="radio" name="deliveryMethod" checked={deliveryMethod === 'PICKUP'} onChange={() => setDeliveryMethod('PICKUP')} />
                <span className="checkout-shipping-option-copy"><strong>Retirar por domicilio del vendedor</strong><small>{deliveryMethods.pickup.address}. {deliveryMethods.pickup.instructions}</small></span><strong className="checkout-shipping-price">Sin cargo</strong>
              </label>}
              {deliveryMethods.localDelivery.enabled && <label className={deliveryMethod === 'LOCAL_DELIVERY' ? 'checkout-shipping-option selected' : 'checkout-shipping-option'}>
                <input type="radio" name="deliveryMethod" checked={deliveryMethod === 'LOCAL_DELIVERY'} onChange={() => setDeliveryMethod('LOCAL_DELIVERY')} />
                <span className="checkout-shipping-option-copy"><strong>Entrega local</strong><small>{localDeliveryAvailable ? (deliveryMethods.localDelivery.coordinate ? 'Costo a coordinar luego de confirmar el pedido.' : 'Disponible para tu código postal.') : 'No disponible para este código postal.'}</small></span><strong className="checkout-shipping-price">{deliveryMethods.localDelivery.coordinate ? 'A coordinar' : formatPrice(deliveryMethods.localDelivery.priceArs || 0)}</strong>
              </label>}
              {deliveryMethods.oca.enabled && <label className={deliveryMethod === 'OCA' ? 'checkout-shipping-option selected' : 'checkout-shipping-option'}>
                <input type="radio" name="deliveryMethod" checked={deliveryMethod === 'OCA'} onChange={() => setDeliveryMethod('OCA')} />
                <span className="checkout-shipping-option-copy"><strong>Envío a domicilio por OCA</strong><small>Un único bulto consolidado con el peso y las dimensiones estimadas de todo el pedido.</small></span>
              </label>}
            </div>}
            {deliveryMethod === 'PICKUP' ? <p className="checkout-shipping-hint">El retiro no depende de tu localidad. Coordinaremos la entrega del pedido luego de confirmarlo.</p> : deliveryMethod === 'LOCAL_DELIVERY' ? <p className="checkout-shipping-hint">{localDeliveryAvailable ? 'La entrega local está disponible para tu destino.' : 'Ingresá un código postal cubierto por la entrega local.'}</p> : null}
            {deliveryMethod === 'OCA' && <>
            {!provinceCode || !/^\d{4}$/.test(postalCode)
              ? <p className="checkout-shipping-hint">Ingresá provincia y código postal para calcular el envío.</p>
              : quoteLoading
                ? <p className="checkout-shipping-hint">Consultando tarifas de OCA...</p>
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
            </>}
          </section>
          {deliveryMethod !== '' && deliveryMethod !== 'PICKUP' && (
            <section className="checkout-card">
              <h2>{deliveryMethod === 'OCA' ? 'Dirección de envío' : 'Dirección de entrega local'}</h2>
              <div className="checkout-fields">
                <label className="checkout-field-full">Calle y altura<input required={deliveryMethod !== 'PICKUP'} minLength={4} maxLength={180} autoComplete="street-address" value={addressLine} onChange={(event) => setAddressLine(event.target.value)} /></label>
                <label>Localidad<input required={deliveryMethod !== 'PICKUP'} minLength={2} maxLength={100} autoComplete="address-level2" value={city} onChange={(event) => setCity(event.target.value)} /></label>
                <label>Provincia
                  <select required={deliveryMethod === 'OCA' || deliveryMethod === 'LOCAL_DELIVERY'} value={provinceCode} onChange={(event) => setProvinceCode(event.target.value)}>
                    <option value="">Seleccionar provincia</option>
                    {PROVINCES.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
                  </select>
                </label>
                <label>Código postal<input required={deliveryMethod !== 'PICKUP'} maxLength={4} minLength={4} inputMode="numeric" pattern="\d{4}" autoComplete="postal-code" value={postalCode} onChange={(event) => setPostalCode(event.target.value.replace(/\D/g, '').slice(0, 4))} /></label>
                <label className="checkout-field-full">Indicaciones adicionales <span>(opcional)</span><textarea maxLength={1000} rows={3} value={customerNotes} onChange={(event) => setCustomerNotes(event.target.value)} placeholder="Piso, departamento, referencias para la entrega..." /></label>
              </div>
            </section>
          )}
          {deliveryMethod === '' && <p className="checkout-shipping-hint">Elegí primero cómo querés recibir tu pedido para completar los datos que correspondan.</p>}
          {error && <div className="checkout-error" role="alert">{error}</div>}
          <button className="checkout-submit" type="submit" disabled={!paymentsConfigLoaded || submitting || cart.length === 0 || !canSubmit}>
            {submitting ? 'Registrando pedido...' : 'Confirmar pedido'}
          </button>
          <p className="checkout-disclaimer">El pedido se registra luego de validar la modalidad de entrega y el stock. {paymentsEnabled ? 'El pago se completa de forma segura en Mercado Pago.' : 'El pago online no está habilitado en este entorno.'}</p>
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
          <div className="checkout-summary-total"><span>Envío</span><strong>{deliveryMethod === '' ? 'A elegir' : deliveryMethod === 'LOCAL_DELIVERY' && deliveryMethods?.localDelivery.coordinate ? 'A coordinar' : canSubmit ? formatPrice(selectedShippingPrice) : 'A calcular'}</strong></div>
          <div className="checkout-summary-grand-total"><span>Total</span><strong>{deliveryMethod === '' || (deliveryMethod === 'LOCAL_DELIVERY' && deliveryMethods?.localDelivery.coordinate) ? 'A confirmar' : formatPrice(displayedSubtotal + selectedShippingPrice)}</strong></div>
          <p className="checkout-summary-note">El importe se calcula según la modalidad seleccionada. El total queda confirmado al registrar el pedido.</p>
        </aside>
      </div>
    </main>
  )
}
