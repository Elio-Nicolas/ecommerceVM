import { useCallback, useEffect, useState } from 'react'
import './payment-return.css'

const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:7381').replace(/\/$/, '')

type PaymentStatus = 'CREATING' | 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED' | 'UNKNOWN' | 'REFUNDED' | 'PARTIALLY_REFUNDED'

type PaymentStatusResponse = {
  data: {
    orderStatus: string
    paymentStatus: PaymentStatus | null
  }
}

type Props = { orderId: string; outcome: 'success' | 'failure' | 'pending'; provider: 'mercadopago' | 'gocuotas' }

export default function PaymentReturnPage({ orderId, outcome, provider }: Props) {
  const [payment, setPayment] = useState<PaymentStatusResponse['data'] | null>(null)
  const [loading, setLoading] = useState(true)
  const [retrying, setRetrying] = useState(false)
  const [error, setError] = useState('')

  const getAccessToken = () => {
    try { return sessionStorage.getItem('ecommercevm:order-access:' + orderId) || '' } catch { return '' }
  }

  const refresh = useCallback(async (signal?: AbortSignal) => {
    const accessToken = getAccessToken()
    if (!accessToken) throw new Error('No encontramos el acceso seguro de este pedido en esta sesión. Contactanos para verificarlo.')
    const response = await fetch(API_URL + '/api/v1/payments/orders/' + encodeURIComponent(orderId) + '/status', {
      headers: { 'X-Order-Access-Token': accessToken },
      cache: 'no-store',
      signal,
    })
    const payload = await response.json() as PaymentStatusResponse | { error?: { message?: string } }
    if (!response.ok || !('data' in payload)) {
      throw new Error(('error' in payload && payload.error?.message) || 'No pudimos consultar el estado del pago.')
    }
    setPayment(payload.data)
  }, [orderId])

  useEffect(() => {
    const controller = new AbortController()
    let active = true
    const run = async () => {
      try {
        await refresh(controller.signal)
      } catch (cause) {
        if (active && !controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'No pudimos consultar el pago.')
      } finally {
        if (active) setLoading(false)
      }
    }
    void run()
    let pollCount = 0
    const interval = window.setInterval(() => {
      if (payment?.paymentStatus === 'APPROVED' || payment?.paymentStatus === 'REJECTED' || payment?.paymentStatus === 'CANCELLED' || payment?.paymentStatus === 'REFUNDED' || payment?.paymentStatus === 'PARTIALLY_REFUNDED' || pollCount >= 20) return
      pollCount += 1
      void refresh(controller.signal).catch(() => undefined)
    }, 15000)
    return () => {
      active = false
      controller.abort()
      window.clearInterval(interval)
    }
  }, [refresh, payment?.paymentStatus])

  async function retryPayment() {
    if (retrying) return
    setRetrying(true)
    setError('')
    try {
      const requestKey = crypto.randomUUID()
      try { sessionStorage.setItem('ecommercevm:payment-request:' + orderId, requestKey) } catch { /* El almacenamiento es opcional. */ }
      const accessToken = getAccessToken()
      if (!accessToken) throw new Error('No encontramos el acceso seguro de este pedido en esta sesión. Contactanos para verificarlo.')
      const paymentPath = provider === 'gocuotas' ? '/api/v1/payments/gocuotas/orders/' : '/api/v1/payments/orders/'
      const response = await fetch(API_URL + paymentPath + encodeURIComponent(orderId), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Order-Access-Token': accessToken },
        body: JSON.stringify({ requestKey }),
      })
      const payload = await response.json() as { data?: { checkoutUrl?: string }; error?: { message?: string } }
      if (!response.ok || !payload.data?.checkoutUrl) {
        throw new Error(payload.error?.message || 'No se pudo iniciar el pago.')
      }
      window.location.assign(payload.data.checkoutUrl)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo iniciar el pago.')
      setRetrying(false)
    }
  }

  useEffect(() => {
    if (payment?.paymentStatus !== 'REJECTED' && payment?.paymentStatus !== 'CANCELLED' && payment?.paymentStatus !== 'REFUNDED' && payment?.paymentStatus !== 'PARTIALLY_REFUNDED') return
    try { sessionStorage.removeItem('ecommercevm:payment-request:' + orderId) } catch { /* El almacenamiento es opcional. */ }
  }, [orderId, payment?.paymentStatus])

  const status = payment?.paymentStatus
  const approved = status === 'APPROVED'
  const rejected = status === 'REJECTED' || status === 'CANCELLED'
  const refunded = status === 'REFUNDED' || status === 'PARTIALLY_REFUNDED'

  return (
    <main className="payment-return-page">
      <section className="payment-return-card">
        <span className="payment-return-kicker">TU TIENDAVM · {provider === 'gocuotas' ? 'GOCUOTAS' : 'MERCADO PAGO'}</span>
        <div className={approved ? 'payment-return-mark approved' : rejected ? 'payment-return-mark rejected' : 'payment-return-mark'}>
          {approved ? '✓' : rejected ? '!' : '…'}
        </div>
        <h1>{approved ? 'Pago confirmado' : refunded ? (status === 'REFUNDED' ? 'Pago reembolsado' : 'Reembolso parcial') : rejected ? 'El pago no se completó' : 'Estamos verificando tu pago'}</h1>
        <p>
          {approved
            ? 'El proveedor confirmó el pago. Tu pedido ya quedó confirmado.'
            : refunded
              ? 'El proveedor informó un reembolso. Si necesitás ayuda con el pedido, contactanos.'
              : rejected
                ? 'No recibimos una aprobación del pago. Podés volver a intentarlo.'
              : outcome === 'failure' ? 'El proveedor no confirmó el pago. Consultamos el estado para evitar duplicar un cobro.' : 'El resultado puede tardar unos instantes. No vuelvas a pagar mientras verificamos la operación.'}
        </p>
        {loading && <p className="payment-return-muted">Consultando el estado...</p>}
        {status === 'PENDING' && <p className="payment-return-muted">El pago sigue pendiente de acreditación.</p>}
        {error && <p className="payment-return-error" role="alert">{error}</p>}
        {!approved && !refunded && <button className="payment-return-primary" onClick={() => void retryPayment()} disabled={retrying || loading}>
          {retrying ? 'Conectando con el proveedor...' : rejected ? 'Intentar pagar nuevamente' : 'Volver al pago'}
        </button>}
        <button className="payment-return-secondary" onClick={() => window.location.replace('/')}>Volver a la tienda</button>
        <small>El estado del pedido se actualiza únicamente con la confirmación verificada del proveedor.</small>
      </section>
    </main>
  )
}
