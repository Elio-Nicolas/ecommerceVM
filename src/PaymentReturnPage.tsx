import { useCallback, useEffect, useState } from 'react'
import './payment-return.css'

const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:7381').replace(/\/$/, '')

type PaymentStatus = 'CREATING' | 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED' | 'UNKNOWN'

type PaymentStatusResponse = {
  data: {
    code: string
    orderStatus: string
    payment: {
      status: PaymentStatus
      statusDetail: string | null
      amountArs: number
      approvedAt: string | null
    } | null
  }
}

type Props = { orderId: string; outcome: 'success' | 'failure' | 'pending' }

export default function PaymentReturnPage({ orderId, outcome }: Props) {
  const [payment, setPayment] = useState<PaymentStatusResponse['data'] | null>(null)
  const [loading, setLoading] = useState(true)
  const [retrying, setRetrying] = useState(false)
  const [error, setError] = useState('')

  const refresh = useCallback(async (signal?: AbortSignal) => {
    const response = await fetch(API_URL + '/api/v1/payments/orders/' + encodeURIComponent(orderId) + '/status', {
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
      if (payment?.payment?.status === 'APPROVED' || payment?.payment?.status === 'REJECTED' || payment?.payment?.status === 'CANCELLED' || pollCount >= 20) return
      pollCount += 1
      void refresh(controller.signal).catch(() => undefined)
    }, 15000)
    return () => {
      active = false
      controller.abort()
      window.clearInterval(interval)
    }
  }, [refresh, payment?.payment?.status])

  async function retryPayment() {
    if (retrying) return
    setRetrying(true)
    setError('')
    try {
      const response = await fetch(API_URL + '/api/v1/payments/orders/' + encodeURIComponent(orderId), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestKey: crypto.randomUUID() }),
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

  const status = payment?.payment?.status
  const approved = status === 'APPROVED'
  const rejected = status === 'REJECTED' || status === 'CANCELLED'

  return (
    <main className="payment-return-page">
      <section className="payment-return-card">
        <span className="payment-return-kicker">ECOMMERCEVM · MERCADO PAGO</span>
        <div className={approved ? 'payment-return-mark approved' : rejected ? 'payment-return-mark rejected' : 'payment-return-mark'}>
          {approved ? '✓' : rejected ? '!' : '…'}
        </div>
        <h1>{approved ? 'Pago confirmado' : rejected ? 'El pago no se completó' : 'Estamos verificando tu pago'}</h1>
        <p>
          {approved
            ? 'Mercado Pago confirmó el pago. Tu pedido ya quedó confirmado.'
            : rejected
              ? 'No recibimos una aprobación del pago. Podés volver a intentarlo.'
              : outcome === 'failure' ? 'Mercado Pago no confirmó el pago. Consultamos el estado para evitar duplicar un cobro.' : 'El resultado puede tardar unos instantes. No vuelvas a pagar mientras verificamos la operación.'}
        </p>
        {payment?.code && <div className="payment-return-code"><span>PEDIDO</span><strong>{payment.code}</strong></div>}
        {loading && <p className="payment-return-muted">Consultando el estado...</p>}
        {status === 'PENDING' && <p className="payment-return-muted">El pago sigue pendiente de acreditación.</p>}
        {error && <p className="payment-return-error" role="alert">{error}</p>}
        {!approved && <button className="payment-return-primary" onClick={() => void retryPayment()} disabled={retrying || loading}>
          {retrying ? 'Conectando con Mercado Pago...' : rejected ? 'Intentar pagar nuevamente' : 'Volver al pago'}
        </button>}
        <button className="payment-return-secondary" onClick={() => window.location.replace('/')}>Volver a la tienda</button>
        <small>El estado del pedido se actualiza únicamente con la confirmación verificada de Mercado Pago.</small>
      </section>
    </main>
  )
}
