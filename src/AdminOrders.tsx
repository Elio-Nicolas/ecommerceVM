import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { formatPrice } from './products'
import OcaAdmissionPanel from './OcaAdmissionPanel'
import './order-logistics.css'

const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:7381').replace(/\/$/, '')
const TOKEN_KEY = 'ecommercevm_admin_token'

type OrderStatus = 'PENDING' | 'CONFIRMED' | 'PREPARING' | 'SHIPPED' | 'DELIVERED' | 'CANCELLED'
type OrderItem = { id: string; productName: string; productSku: string; unitPriceArs: number; quantity: number; lineTotalArs: number }
type OrderHistory = { id: string; fromStatus: OrderStatus | null; toStatus: OrderStatus; note: string | null; createdAt: string; changedByAdmin?: { email: string } | null }
type Order = {
  id: string; code: string; status: OrderStatus; paymentMethod: 'CASH' | 'MERCADO_PAGO' | 'GOCUOTAS'; paymentSurchargeMilliPercent: number; paymentSurchargeArs: number; customerName: string; customerEmail: string | null
  customerPhone: string; addressLine: string; city: string; province: string; postalCode: string | null
  customerNotes: string | null; subtotalArs: number; shippingCostArs: number | null; totalArs: number | null
  shippingCarrier: string | null; trackingCode: string | null; shippingService: string | null; shippingEstimatedHours: number | null
  deliveryMethod: 'OCA' | 'ANDREANI' | 'LOCAL_DELIVERY' | 'PICKUP' | 'LEGACY_CARRIER'; shippingInternalCostArs: number | null; deliveryInstructions: string | null
  shipments?: { provider: string; status: string; trackingNumber: string | null }[]
  shippingCostOptions: { priceArs?: number; serviceCode?: string; sellerCostStatus?: 'AVAILABLE' | 'UNAVAILABLE'; sellerOptions?: { carrierId: string; carrierName: string; costArs: number; estimatedHours: number | null; fulfillmentMode: string }[] } | null
  createdAt: string; paymentReceivedAt: string | null; receiptEmailSentAt: string | null; items: OrderItem[]; history: OrderHistory[]
  cancellationRequest?: { id: string; status: 'REQUESTED' | 'PROCESSING' | 'REFUNDED' | 'FAILED'; returnStatus: 'NOT_REQUIRED' | 'RETURN_PENDING' | 'RETURN_RECEIVED' | 'RETURN_ACCEPTED'; providerRefundId: string | null; providerStatus: string | null; lastError: string | null; createdAt: string } | null
  paymentAttempts?: { id: string; provider: string; providerOrderId: string | null; status: 'CREATING' | 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED' | 'UNKNOWN' | 'REFUNDED' | 'PARTIALLY_REFUNDED'; statusDetail: string | null; amountArs: number; approvedAt: string | null; createdAt: string }[]
  fiscalDocuments?: { id: string; type: 'INVOICE_C' | 'CREDIT_NOTE_C' | 'DEBIT_NOTE_C'; status: 'PENDING' | 'ISSUING' | 'AUTHORIZED' | 'REJECTED' | 'UNKNOWN'; pointOfSale: number | null; voucherType: number; voucherNumber: number | null; cae: string | null; caeExpiresAt: string | null; lastErrorMessage: string | null; createdAt: string }[]
}
type ApiResponse<T> = { data: T; pagination?: { page: number; limit: number; total: number; totalPages: number } }

const statusLabels: Record<OrderStatus, string> = {
  PENDING: 'Pendiente', CONFIRMED: 'Confirmado', PREPARING: 'Preparando',
  SHIPPED: 'Enviado', DELIVERED: 'Entregado', CANCELLED: 'Cancelado',
}
const nextStatuses: Record<OrderStatus, OrderStatus[]> = {
  PENDING: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['PREPARING', 'CANCELLED'],
  PREPARING: ['SHIPPED', 'CANCELLED'],
  SHIPPED: ['DELIVERED'],
  DELIVERED: [],
  CANCELLED: [],
}

function historyEventLabel(entry: OrderHistory): string {
  if (entry.fromStatus === null) return 'Pedido creado'
  if (entry.fromStatus !== entry.toStatus) return statusLabels[entry.toStatus]
  if (entry.note?.startsWith('Costo de entrega local coordinado:')) return 'Costo de entrega coordinado'
  if (entry.note?.startsWith('Envío actualizado.')) return 'Datos de envío actualizados'
  return 'Actualización del pedido'
}

function availableNextStatuses(order: Order): OrderStatus[] {
  if (order.status === 'SHIPPED') return ['DELIVERED']
  if (order.cancellationRequest && ['REQUESTED', 'PROCESSING', 'FAILED'].includes(order.cancellationRequest.status)) return []
  const paymentStatuses = (order.paymentAttempts || []).map((payment) => payment.status)
  if (paymentStatuses.some((status) => ['CREATING', 'PENDING', 'UNKNOWN'].includes(status))) return []
  if (paymentStatuses.includes('PARTIALLY_REFUNDED')) return []
  if (paymentStatuses.includes('APPROVED')) return nextStatuses[order.status].filter((status) => status !== 'CANCELLED')
  if (paymentStatuses.includes('REFUNDED')) return nextStatuses[order.status].includes('CANCELLED') ? ['CANCELLED'] : []
  if (order.status === 'PREPARING' && (order.deliveryMethod === 'OCA' || order.deliveryMethod === 'ANDREANI') && !order.shipments?.some((shipment) => shipment.provider === order.deliveryMethod && shipment.status === 'PROCESSED' && Boolean(shipment.trackingNumber))) return ['CANCELLED']
  if (order.status === 'PENDING' && order.deliveryMethod === 'LOCAL_DELIVERY' && order.shippingService === 'A coordinar' && order.shippingCostArs === null) return ['CANCELLED']
  if (order.status === 'PREPARING' && order.deliveryMethod === 'PICKUP') return ['DELIVERED', 'CANCELLED']
  if (order.status === 'PREPARING' && order.deliveryMethod === 'LOCAL_DELIVERY' && order.shippingService === 'A coordinar' && order.shippingCostArs === null) return ['CANCELLED']
  return nextStatuses[order.status]
}

async function request<T>(path: string, token: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}/api/v1${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...init?.headers },
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload?.error?.message || 'No se pudo completar la operación.')
  return payload as T
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('es-AR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))
}

export default function AdminOrders() {
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY) || '')
  const [checking, setChecking] = useState(true)
  const [orders, setOrders] = useState<Order[]>([])
  const [status, setStatus] = useState('ALL')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [selected, setSelected] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [updating, setUpdating] = useState(false)
  const [shippingSaving, setShippingSaving] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [printSelection, setPrintSelection] = useState<string[]>([])
  const [printOrders, setPrintOrders] = useState<Order[]>([])
  const [printKind, setPrintKind] = useState<'receipt' | 'prep' | null>(null)
  const [invoiceDocumentType, setInvoiceDocumentType] = useState('99')
  const [invoiceDocumentNumber, setInvoiceDocumentNumber] = useState('0')
  const [invoiceVatCondition, setInvoiceVatCondition] = useState('')
  const [invoiceReceiverName, setInvoiceReceiverName] = useState('')
  const [invoiceReceiverAddress, setInvoiceReceiverAddress] = useState('')
  const [invoicePaymentConfirmed, setInvoicePaymentConfirmed] = useState(false)
  const [invoiceIssuing, setInvoiceIssuing] = useState(false)
  const [invoiceDownloadingId, setInvoiceDownloadingId] = useState<string | null>(null)
  const [paymentReconcilingId, setPaymentReconcilingId] = useState<string | null>(null)
  const [paymentReconcileFeedback, setPaymentReconcileFeedback] = useState<Record<string, string>>({})
  const [refundProcessing, setRefundProcessing] = useState(false)
  const [paymentReceivingId, setPaymentReceivingId] = useState<string | null>(null)

  const loadOrders = useCallback(async (authToken: string) => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ page: String(page), limit: '20' })
      if (status !== 'ALL') params.set('status', status)
      if (search.trim()) params.set('q', search.trim())
      const result = await request<ApiResponse<Order[]>>(`/admin/orders?${params.toString()}`, authToken)
      setOrders(result.data)
      setPrintSelection((current) => current.filter((id) => result.data.some((order) => order.id === id)))
      setTotal(result.pagination?.total ?? result.data.length)
      setTotalPages(result.pagination?.totalPages ?? 1)
      setError('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudieron cargar los pedidos.')
    } finally {
      setLoading(false)
    }
  }, [page, search, status])

  useEffect(() => {
    if (!token) {
      window.location.replace('/admin')
      return
    }
    let active = true
    request<{ data: { email: string } }>('/auth/me', token)
      .then(() => { if (active) setChecking(false) })
      .catch(() => {
        localStorage.removeItem(TOKEN_KEY)
        if (active) window.location.replace('/admin')
      })
    return () => { active = false }
  }, [token])

  useEffect(() => {
    if (!checking && token) void loadOrders(token)
  }, [checking, token, loadOrders])

  useEffect(() => {
    if (!printKind || printOrders.length === 0) return
    let secondFrame = 0
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => window.print())
    })
    return () => {
      window.cancelAnimationFrame(firstFrame)
      if (secondFrame) window.cancelAnimationFrame(secondFrame)
    }
  }, [printKind, printOrders])

  useEffect(() => {
    if (!printKind) return
    const clearPrint = () => setPrintKind(null)
    window.addEventListener('afterprint', clearPrint)
    return () => window.removeEventListener('afterprint', clearPrint)
  }, [printKind])

  async function reconcilePayment(order: Order, attemptId: string) {
    if (!token || paymentReconcilingId) return
    setPaymentReconcilingId(attemptId)
    setPaymentReconcileFeedback((current) => ({ ...current, [attemptId]: 'Consultando Mercado Pago…' }))
    setError('')
    setNotice('')
    try {
      const result = await request<{ data: { status: string; statusDetail: string | null }; message: string }>(
        `/payments/admin/orders/${order.id}/attempts/${attemptId}/reconcile`,
        token,
        { method: 'POST' },
      )
      const detail = result.data.statusDetail || result.data.status
      const feedback = `Consulta completada: ${result.data.status} · ${detail}`
      setPaymentReconcileFeedback((current) => ({ ...current, [attemptId]: feedback }))
      setNotice(`Mercado Pago consultado para el pedido ${order.code}: ${detail}.`)
      await loadOrders(token)
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'No se pudo consultar el pago en Mercado Pago.'
      setPaymentReconcileFeedback((current) => ({ ...current, [attemptId]: `Error al consultar: ${message}` }))
      setError(message)
    } finally {
      setPaymentReconcilingId(null)
    }
  }

  async function registerCashPayment(order: Order) {
    if (!token || paymentReceivingId) return
    if (!window.confirm(`Confirmás que recibiste efectivamente el pago del pedido ${order.code}? Se confirmará el pedido y se enviará el correo al comprador.`)) return
    setPaymentReceivingId(order.id)
    setError('')
    setNotice('')
    try {
      const result = await request<{ message: string }>(`/admin/orders/${order.id}/payment-received`, token, {
        method: 'POST',
        body: JSON.stringify({ note: 'Cobro en efectivo/a coordinar verificado por administración.' }),
      })
      setNotice(result.message)
      await loadOrders(token)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo registrar el cobro.')
    } finally {
      setPaymentReceivingId(null)
    }
  }

  async function prepareRefund(order: Order) {
    if (!token || refundProcessing) return
    setRefundProcessing(true)
    setError('')
    setNotice('')
    try {
      const result = await request<{ message: string }>(
        `/admin/orders/${order.id}/refund/request`, token, { method: 'POST' },
      )
      setNotice(result.message)
      await loadOrders(token)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo iniciar la gestión de reintegro.')
    } finally {
      setRefundProcessing(false)
    }
  }

  async function confirmGoCuotasRefund(order: Order) {
    if (!token || refundProcessing || !order.cancellationRequest) return
    const confirmed = window.confirm(
      `Confirmás que ya ingresaste al panel de GOcuotas y ejecutaste allí el reintegro total del pedido ${order.code}? Esta acción solo registra la confirmación en la tienda; no mueve dinero.`,
    )
    if (!confirmed) return
    setRefundProcessing(true)
    setError('')
    setNotice('')
    try {
      const result = await request<{ message: string }>(
        `/admin/orders/${order.id}/refund/gocuotas-confirmation`, token,
        { method: 'POST', body: JSON.stringify({}) },
      )
      setNotice(result.message)
      await loadOrders(token)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo registrar la confirmación de GOcuotas.')
    } finally {
      setRefundProcessing(false)
    }
  }



  async function resolveUnpaidCashOrder(order: Order) {
    if (!token || refundProcessing || !order.cancellationRequest) return
    if (!window.confirm('Confirmás que no recibiste ningún pago por este pedido? Se resolverá la solicitud y, si todavía no fue despachado, se cancelará y repondrá el stock.')) return
    setRefundProcessing(true)
    setError('')
    setNotice('')
    try {
      const result = await request<{ message: string }>(`/admin/orders/${order.id}/refund/no-payment-collected`, token, { method: 'POST' })
      setNotice(result.message)
      await loadOrders(token)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo resolver el pedido sin cobro.')
    } finally {
      setRefundProcessing(false)
    }
  }

  async function confirmCashRefund(order: Order) {
    if (!token || refundProcessing || !order.cancellationRequest) return
    const reference = window.prompt('Ingresá el número de recibo, comprobante o referencia del reintegro en efectivo:')
    if (!reference?.trim()) return
    const confirmed = window.confirm('Confirmás que el dinero ya fue devuelto al comprador? Esta acción registra la constancia y puede cancelar el pedido y reponer el stock.')
    if (!confirmed) return
    setRefundProcessing(true)
    setError('')
    setNotice('')
    try {
      const result = await request<{ message: string }>(`/admin/orders/${order.id}/refund/manual-confirmation`, token, {
        method: 'POST', body: JSON.stringify({ reference: reference.trim() }),
      })
      setNotice(result.message)
      await loadOrders(token)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo registrar el reintegro en efectivo.')
    } finally {
      setRefundProcessing(false)
    }
  }

  async function markReturnReceived(order: Order) {
    if (!token || refundProcessing) return
    if (!window.confirm('Confirmás que el producto devuelto ya llegó físicamente a la tienda?')) return
    setRefundProcessing(true)
    try {
      const result = await request<{ message: string }>(`/admin/orders/${order.id}/refund/return-received`, token, { method: 'POST' })
      setNotice(result.message)
      await loadOrders(token)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo registrar la recepción física.')
    } finally {
      setRefundProcessing(false)
    }
  }

  async function acceptReturn(order: Order) {
    if (!token || refundProcessing) return
    if (!window.confirm('Confirmás que inspeccionaste el producto y está en condiciones de reingresar al stock? Esta acción repone las unidades una sola vez.')) return
    setRefundProcessing(true)
    try {
      const result = await request<{ message: string }>(`/admin/orders/${order.id}/refund/return-accepted`, token, { method: 'POST' })
      setNotice(result.message)
      await loadOrders(token)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo aceptar la devolución.')
    } finally {
      setRefundProcessing(false)
    }
  }

  async function processRefund(order: Order) {
    if (!token || refundProcessing || !order.cancellationRequest) return
    const isRetry = order.cancellationRequest.status === 'PROCESSING'
    const prompt = isRetry
      ? 'Se consultará el estado del reembolso en Mercado Pago. ¿Continuar?'
      : `Se solicitará a Mercado Pago el reembolso total del pedido ${order.code}. Esta acción devuelve el dinero al comprador. ¿Continuar?`
    if (!window.confirm(prompt)) return
    setRefundProcessing(true)
    setError('')
    setNotice('')
    try {
      const result = await request<{ data: { status: string }; message: string }>(`/admin/orders/${order.id}/refund`, token, { method: 'POST' })
      setNotice(result.message)
      await loadOrders(token)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo procesar el reembolso.')
      await loadOrders(token)
    } finally {
      setRefundProcessing(false)
    }
  }

  async function saveShipping(event: FormEvent<HTMLFormElement>, order: Order) {
    event.preventDefault()
    if (!token || shippingSaving) return
    const formData = new FormData(event.currentTarget)
    const rawShippingCost = formData.get('shippingCostArs')
    const hasShippingCost = rawShippingCost !== null && String(rawShippingCost).trim() !== ''
    const shippingCostArs = hasShippingCost ? Number(rawShippingCost) : undefined
    if (hasShippingCost && (!Number.isSafeInteger(shippingCostArs as number) || (shippingCostArs as number) < 0)) {
      setError('Ingresá un costo de envío válido.')
      return
    }
    const shippingCarrier = String(formData.get('shippingCarrier') || '').trim() || null
    const trackingCode = String(formData.get('trackingCode') || '').trim() || null
    const deliveryNote = String(formData.get('deliveryNote') || '').trim() || undefined
    if (!hasShippingCost && !shippingCarrier && !trackingCode && !deliveryNote) {
      setError('Ingresá al menos un dato de entrega para guardar.')
      return
    }
    setShippingSaving(true)
    setError('')
    setNotice('')
    try {
      await request(`/admin/orders/${order.id}/shipping`, token, {
        method: 'PATCH',
        body: JSON.stringify({
          ...(hasShippingCost ? { shippingCostArs } : {}),
          ...(formData.has('shippingCarrier') ? { shippingCarrier } : {}),
          ...(formData.has('trackingCode') ? { trackingCode } : {}),
          note: deliveryNote,
        }),
      })
      setNotice(hasShippingCost
        ? `Costo de entrega del pedido ${order.code} registrado. Total actualizado: ${formatPrice(order.subtotalArs + (shippingCostArs as number))}. Ahora confirmá el costo para continuar.`
        : `Datos de entrega del pedido ${order.code} actualizados.`)
      await loadOrders(token)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo actualizar el envío.')
    } finally {
      setShippingSaving(false)
    }
  }

  async function issueInvoiceC(order: Order, event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!token || invoiceIssuing) return
    if (!invoicePaymentConfirmed) {
      setError('Confirmá que verificaste el cobro antes de emitir la factura.')
      return
    }
    const documentType = Number(invoiceDocumentType)
    const vatCondition = Number(invoiceVatCondition)
    if (!Number.isInteger(documentType) || documentType < 1 || documentType > 99) {
      setError('Ingresá un tipo de documento válido según ARCA.')
      return
    }
    if (!/^\d{1,20}$/.test(invoiceDocumentNumber.trim())) {
      setError('Ingresá el número de documento del receptor. Para consumidor final sin identificar, usá el tipo y número que correspondan según ARCA.')
      return
    }
    if (!Number.isInteger(vatCondition) || vatCondition < 1) {
      setError('Ingresá la condición frente al IVA del receptor usando el ID informado por ARCA.')
      return
    }
    if (!window.confirm(`Vas a solicitar una Factura C de prueba en ARCA homologación para el pedido ${order.code}. Verificá que el pago esté efectivamente cobrado. ¿Continuar?`)) return

    setInvoiceIssuing(true)
    setError('')
    setNotice('')
    try {
      const result = await request<{ data: { status: string; voucherNumber: number | null; cae: string | null }; message: string }>(
        `/admin/arca/orders/${order.id}/invoice-c`,
        token,
        {
          method: 'POST',
          body: JSON.stringify({
            requestKey: crypto.randomUUID(),
            paymentConfirmed: true,
            receiverDocumentType: documentType,
            receiverDocumentNumber: invoiceDocumentNumber.trim(),
            receiverVatConditionId: vatCondition,
            receiverName: invoiceReceiverName.trim() || order.customerName,
            receiverAddress: invoiceReceiverAddress.trim() || [order.addressLine, order.city, order.province, order.postalCode].filter(Boolean).join(', '),
          }),
        },
      )
      setNotice(result.message)
      setInvoicePaymentConfirmed(false)
      await loadOrders(token)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo emitir la Factura C.')
      await loadOrders(token)
    } finally {
      setInvoiceIssuing(false)
    }
  }


  async function reconcileInvoiceC(order: Order, documentId: string) {
    if (!token || invoiceIssuing) return
    if (!window.confirm(`Se consultará en ARCA homologación la Factura C reservada para el pedido ${order.code}. No se enviará una nueva emisión. ¿Continuar?`)) return
    setInvoiceIssuing(true)
    setError('')
    setNotice('')
    try {
      const result = await request<{ data: { status: string }; message: string }>(
        `/admin/arca/documents/${documentId}/reconcile`,
        token,
        { method: 'POST' },
      )
      setNotice(result.message)
      await loadOrders(token)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo consultar el comprobante en ARCA.')
      await loadOrders(token)
    } finally {
      setInvoiceIssuing(false)
    }
  }

  async function downloadInvoicePdf(orderCode: string, documentId: string) {
    if (!token || invoiceDownloadingId) return
    setInvoiceDownloadingId(documentId)
    setError('')
    try {
      const response = await fetch(`${API_URL}/api/v1/admin/arca/documents/${documentId}/pdf`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}))
        throw new Error(payload?.error?.message || 'No se pudo descargar la factura.')
      }
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `factura-c-${orderCode}.pdf`
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo descargar la factura.')
    } finally {
      setInvoiceDownloadingId(null)
    }
  }

  async function changeStatus(order: Order, next: OrderStatus) {
    if (!token || updating) return
    setUpdating(true)
    setError('')
    setNotice('')
    try {
      await request(`/admin/orders/${order.id}/status`, token, {
        method: 'PATCH',
        body: JSON.stringify({ status: next, note: note.trim() || undefined }),
      })
      setSelected(null)
      setNote('')
      setNotice(`Pedido ${order.code}: estado actualizado a ${statusLabels[next].toLowerCase()}.`)
      await loadOrders(token)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo actualizar el pedido.')
    } finally {
      setUpdating(false)
    }
  }

  function togglePrintSelection(id: string) {
    setPrintSelection((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])
  }

  function printCurrentOrder(order: Order, kind: 'receipt' | 'prep') {
    setPrintOrders([order])
    setPrintKind(kind)
  }

  function printSelectedOrders() {
    const selectedOrders = orders.filter((order) => printSelection.includes(order.id))
    if (!selectedOrders.length) return
    setPrintOrders(selectedOrders)
    setPrintKind('prep')
  }

  if (checking) return <div className="admin-loading">Verificando sesión...</div>

  const activeOrder = orders.find((order) => order.id === selected) || null

  return (
    <div className={`admin-layout${printKind ? ' printing-orders' : ''}`}>
      <aside className="admin-sidebar">
        <a className="admin-brand" href="/"><svg className="admin-brand-mark" viewBox="0 0 40 48" role="img" aria-label="VM, Villa Mercedes"><path d="M20 2.5C10.2 2.5 2.5 10.2 2.5 20c0 12.2 17.5 25.3 17.5 25.3S37.5 32.2 37.5 20C37.5 10.2 29.8 2.5 20 2.5Z" fill="#E04B2F" /><circle cx="20" cy="19.5" r="11.5" fill="#fff" /><text x="20" y="23.2" textAnchor="middle" fill="#E04B2F" fontFamily="Manrope, sans-serif" fontSize="9.5" fontWeight="800" letterSpacing="-.4">VM</text></svg><span>Tu Tienda<span>VM</span></span></a>
        <div className="admin-nav-label">GESTIÓN</div>
        <a className="admin-nav-item" href="/admin"><span className="admin-nav-icon">▦</span> Productos</a>
        <a className="admin-nav-item active" href="/admin/pedidos"><span className="admin-nav-icon">▤</span> Pedidos</a>
        <div className="admin-sidebar-bottom"><span className="admin-avatar">A</span><div><strong>Sesión administrativa</strong><small>Administrador</small></div><button onClick={() => { setToken(''); localStorage.removeItem(TOKEN_KEY); window.location.replace('/admin') }} title="Cerrar sesión">↗</button></div>
      </aside>

      <main className="admin-main">
        <header className="admin-topbar"><div><span>TU TIENDAVM / ADMINISTRACIÓN</span><h1>Pedidos</h1></div><a href="/" className="admin-store-link">Ver tienda ↗</a></header>
        <section className="admin-content">
          <div className="admin-page-heading"><div><h2>Gestión de pedidos</h2><p>Consultá pedidos, revisá sus datos y actualizá el estado de preparación y entrega.</p></div></div>
          <div className="admin-stats order-stats">
            <div><span>PEDIDOS EN LISTADO</span><strong>{total}</strong></div>
            <div><span>PENDIENTES EN ESTA PÁGINA</span><strong>{orders.filter((item) => item.status === 'PENDING').length}</strong></div>
            <div><span>EN PREPARACIÓN EN ESTA PÁGINA</span><strong>{orders.filter((item) => item.status === 'PREPARING').length}</strong></div>
            <div><span>ENTREGADOS EN ESTA PÁGINA</span><strong>{orders.filter((item) => item.status === 'DELIVERED').length}</strong></div>
          </div>
          {notice && <div className="admin-alert success">{notice}</div>}
          {error && <div className="admin-alert error">{error}</div>}
          <div className="admin-table-card">
            <div className="admin-table-toolbar">
              <label className="admin-search"><span>⌕</span><input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); setPrintSelection([]) }} placeholder="Buscar por código, cliente o teléfono..." /></label>
              <select value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); setPrintSelection([]) }} aria-label="Filtrar por estado">
                <option value="ALL">Todos los estados</option>
                {Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </div>
            {printSelection.length > 0 && <div className="order-print-toolbar"><span>{printSelection.length} pedido(s) seleccionados</span><button className="admin-primary" type="button" onClick={printSelectedOrders}>Imprimir preparación por lote</button><button className="admin-quiet-button" type="button" onClick={() => setPrintSelection([])}>Limpiar selección</button></div>}
            {loading ? <div className="admin-table-empty">Cargando pedidos...</div> : orders.length === 0 ? <div className="admin-table-empty">Todavía no hay pedidos para mostrar.</div> : (
              <div className="admin-table-scroll"><table className="admin-table order-table"><thead><tr><th>IMPRIMIR</th><th>PEDIDO</th><th>CLIENTE</th><th>FECHA</th><th>ARTÍCULOS</th><th>TOTAL</th><th>ESTADO</th><th>DETALLE</th></tr></thead><tbody>
                {orders.map((order) => <tr key={order.id}>
                  <td><input aria-label={`Seleccionar ${order.code} para impresión por lote`} type="checkbox" checked={printSelection.includes(order.id)} onChange={() => togglePrintSelection(order.id)} /></td><td><strong>{order.code}</strong></td><td><strong>{order.customerName}</strong><small className="order-phone">{order.customerPhone}</small></td>
                  <td>{formatDate(order.createdAt)}</td><td>{order.items.reduce((sum, item) => sum + item.quantity, 0)}</td>
                  <td className="admin-price">{order.totalArs === null ? 'Pendiente de envío' : formatPrice(order.totalArs)}</td>
                  <td><span className={`admin-status order-status ${order.status.toLowerCase()}`}>{statusLabels[order.status]}</span></td>
                  <td><button className="order-detail-button" onClick={() => { setSelected(selected === order.id ? null : order.id); setNote(''); setInvoiceReceiverName(''); setInvoiceReceiverAddress(''); setInvoicePaymentConfirmed(false) }}>{selected === order.id ? 'Cerrar' : 'Ver pedido'}</button></td>
                </tr>)}
              </tbody></table></div>
            )}
            <div className="admin-table-footer order-pagination"><span>Mostrando {orders.length} de {total} pedidos</span><div><button disabled={page <= 1 || loading} onClick={() => { setPrintSelection([]); setPage((value) => value - 1) }}>Anterior</button><span>{page} / {totalPages}</span><button disabled={page >= totalPages || loading} onClick={() => { setPrintSelection([]); setPage((value) => value + 1) }}>Siguiente</button></div></div>
          </div>

          {activeOrder && <section className="order-detail-card">
            <div className="admin-form-heading"><div><span className="admin-kicker">PEDIDO {activeOrder.code}</span><h2>Detalle del pedido</h2></div><div className="admin-category-actions"><button type="button" className="admin-quiet-button" onClick={() => printCurrentOrder(activeOrder, 'receipt')}>Imprimir ticket</button><button type="button" className="admin-quiet-button" onClick={() => printCurrentOrder(activeOrder, 'prep')}>Etiqueta de preparación</button><button className="admin-quiet-button" onClick={() => setSelected(null)}>Cerrar</button></div></div>
            <div className="order-detail-grid">
              <div><span>CLIENTE</span><strong>{activeOrder.customerName}</strong><small>{activeOrder.customerPhone}</small><small>{activeOrder.customerEmail || 'Sin correo informado'}</small></div>
              <div><span>MODALIDAD DE ENTREGA</span><strong>{activeOrder.deliveryMethod === 'PICKUP' ? 'Retiro por domicilio del vendedor' : activeOrder.deliveryMethod === 'LOCAL_DELIVERY' ? 'Entrega local' : activeOrder.deliveryMethod === 'LEGACY_CARRIER' ? 'Proveedor anterior (histórico)' : activeOrder.deliveryMethod === 'ANDREANI' ? 'Andreani' : 'OCA'}</strong><small>{activeOrder.deliveryInstructions || [activeOrder.addressLine, activeOrder.city, activeOrder.province, activeOrder.postalCode].filter(Boolean).join(' · ')}</small></div>
              <div><span>NOTAS</span><strong>{activeOrder.customerNotes || 'Sin indicaciones adicionales'}</strong></div>
            </div>
            <div className="order-items-list"><h3>Productos</h3>{activeOrder.items.map((item) => <div key={item.id}><span>{item.quantity} × {item.productName}<small>{item.productSku} · {formatPrice(item.unitPriceArs)} c/u</small></span><strong>{formatPrice(item.lineTotalArs)}</strong></div>)}</div>
            {activeOrder.deliveryMethod === 'OCA' && <OcaAdmissionPanel order={activeOrder} token={token} onComplete={() => { void loadOrders(token) }} />}
            <div className="order-totals"><span>Subtotal</span><strong>{formatPrice(activeOrder.subtotalArs)}</strong><small>{activeOrder.shippingCostArs === null ? 'Envío: pendiente de coordinación' : `Envío: ${formatPrice(activeOrder.shippingCostArs)}`}</small><span>Total del pedido</span><strong>{activeOrder.totalArs === null ? 'Pendiente de coordinación' : formatPrice(activeOrder.totalArs)}</strong></div>
            {activeOrder.paymentMethod === 'CASH' && <section className="order-payment-card">
              <div className="order-payment-heading"><div><span className="admin-kicker">COBRO MANUAL</span><h3>Efectivo / a coordinar</h3></div><small>{activeOrder.paymentReceivedAt ? `Cobrado · ${formatDate(activeOrder.paymentReceivedAt)}` : 'Pendiente de cobro'}</small></div>
              {activeOrder.paymentReceivedAt
                ? <div className="order-payment-attempt"><p>El cobro fue registrado el {formatDate(activeOrder.paymentReceivedAt)}.</p><button type="button" className="admin-quiet-button" disabled={paymentReceivingId !== null} onClick={() => void registerCashPayment(activeOrder)}>{paymentReceivingId === activeOrder.id ? 'Verificando correo...' : 'Verificar / reintentar correo de confirmación'}</button></div>
                : <div className="order-payment-attempt"><p>Registrá el cobro únicamente después de recibir el dinero. Esta acción confirma el pedido si todavía estaba pendiente y dispara el correo de pago confirmado.</p><button type="button" className="admin-primary" disabled={paymentReceivingId !== null || activeOrder.status === 'CANCELLED'} onClick={() => void registerCashPayment(activeOrder)}>{paymentReceivingId === activeOrder.id ? 'Registrando cobro...' : 'Registrar pago recibido'}</button></div>}
            </section>}
            <section className="order-payment-card">
              <div className="order-payment-heading"><div><span className="admin-kicker">MEDIO DE PAGO</span><h3>{activeOrder.paymentMethod === 'GOCUOTAS' ? 'GOcuotas' : activeOrder.paymentMethod === 'CASH' ? 'Efectivo' : 'Mercado Pago'}</h3></div><small>{activeOrder.paymentMethod === 'CASH' ? 'Registro manual de cobro' : 'Estado informado por el proveedor'}</small></div>
              {(activeOrder.paymentAttempts || []).map((payment) => <div className="order-payment-attempt" key={payment.id}>
                <div><strong>{payment.status === 'APPROVED' ? 'Pago aprobado' : payment.status === 'REJECTED' ? 'Pago rechazado' : payment.status === 'CANCELLED' ? 'Pago cancelado' : payment.status === 'REFUNDED' ? 'Pago reembolsado' : payment.status === 'PARTIALLY_REFUNDED' ? 'Reembolso parcial' : payment.status === 'UNKNOWN' ? 'Resultado incierto' : payment.status === 'CREATING' ? 'Creando pago' : 'Pago pendiente'}</strong><small>{payment.statusDetail || 'Sin detalle informado'} · {formatDate(payment.createdAt)}</small></div>
                <strong>{formatPrice(payment.amountArs)}</strong>
                {payment.providerOrderId && <small className="order-payment-reference">Orden {payment.provider === 'GOCUOTAS' ? 'GOcuotas' : 'Mercado Pago'}: {payment.providerOrderId}</small>}
                {payment.approvedAt && <small className="order-payment-reference">Aprobado: {formatDate(payment.approvedAt)}</small>}
                {payment.provider === 'MERCADO_PAGO' && payment.providerOrderId && ['CREATING', 'PENDING', 'UNKNOWN', 'APPROVED', 'PARTIALLY_REFUNDED', 'REJECTED', 'CANCELLED'].includes(payment.status) && <><button type="button" className="admin-quiet-button" disabled={paymentReconcilingId !== null} onClick={() => void reconcilePayment(activeOrder, payment.id)}>{paymentReconcilingId === payment.id ? 'Consultando Mercado Pago...' : 'Consultar estado real en Mercado Pago'}</button>{paymentReconcileFeedback[payment.id] && <small className="order-payment-reference" role="status">{paymentReconcileFeedback[payment.id]}</small>}</>}
                {payment.provider === 'GOCUOTAS' && <small className="order-payment-reference">Conciliación automática mediante webhook de GOcuotas.</small>}
              </div>)}
              {!(activeOrder.paymentAttempts || []).length && <p className="order-payment-empty">Este pedido no tiene intentos de pago online registrados.</p>}
            </section>
            {(((activeOrder.paymentAttempts || []).some((payment) => ['APPROVED', 'PARTIALLY_REFUNDED'].includes(payment.status))) || activeOrder.paymentMethod === 'CASH') && !activeOrder.cancellationRequest && <section className="order-payment-card">
              <div className="order-payment-heading"><div><span className="admin-kicker">GESTIÓN DE REINTEGRO</span><h3>{activeOrder.paymentMethod === 'CASH' ? 'Reintegro en efectivo' : 'Pago cobrado'}</h3></div></div>
              <p>{activeOrder.paymentMethod === 'CASH' ? 'Registrá la solicitud para dejar bloqueada la preparación mientras se coordina el reintegro en efectivo.' : 'Antes de cancelar un pedido pagado, iniciá la gestión de reintegro con el mismo proveedor que cobró.'}</p>
              <button type="button" className="admin-primary" disabled={refundProcessing} onClick={() => void prepareRefund(activeOrder)}>{refundProcessing ? 'Registrando...' : 'Iniciar gestión de reintegro'}</button>
            </section>}
            {activeOrder.cancellationRequest && <section className="order-payment-card">
              <div className="order-payment-heading"><div><span className="admin-kicker">GESTIÓN DE REINTEGRO</span><h3>{activeOrder.paymentMethod === 'GOCUOTAS' ? 'GOcuotas' : activeOrder.paymentMethod === 'CASH' ? 'Efectivo' : 'Mercado Pago'}</h3></div><small>{formatDate(activeOrder.cancellationRequest.createdAt)}</small></div>
              <div className="order-payment-attempt">
                <strong>{activeOrder.cancellationRequest.status === 'REQUESTED' ? 'Solicitud recibida · preparación bloqueada' : activeOrder.cancellationRequest.status === 'PROCESSING' ? 'Reembolso en proceso' : activeOrder.cancellationRequest.status === 'REFUNDED' ? (activeOrder.cancellationRequest.providerStatus === 'NO_PAYMENT_COLLECTED' ? 'Solicitud resuelta · sin cobro' : 'Reembolso confirmado') : 'Reembolso con error'}</strong>
                <small>N.º de gestión: {activeOrder.cancellationRequest.id}</small><small>{activeOrder.cancellationRequest.providerStatus || activeOrder.cancellationRequest.lastError || 'El reintegro todavía no fue confirmado.'}</small><small>Devolución física: {activeOrder.cancellationRequest.returnStatus === 'RETURN_PENDING' ? 'Pendiente de recepción' : activeOrder.cancellationRequest.returnStatus === 'RETURN_RECEIVED' ? 'Recibida · pendiente de inspección' : activeOrder.cancellationRequest.returnStatus === 'RETURN_ACCEPTED' ? 'Inspeccionada y aceptada · stock repuesto' : 'No requiere devolución física'}</small>
                {activeOrder.cancellationRequest.providerRefundId && <small className="order-payment-reference">Referencia de reintegro: {activeOrder.cancellationRequest.providerRefundId}</small>}
                {activeOrder.paymentMethod === 'MERCADO_PAGO' && activeOrder.cancellationRequest.status !== 'REFUNDED' && <button type="button" className="admin-primary" disabled={refundProcessing} onClick={() => void processRefund(activeOrder)}>{refundProcessing ? 'Consultando Mercado Pago…' : activeOrder.cancellationRequest.status === 'PROCESSING' ? 'Consultar estado del reembolso' : 'Procesar reintegro en Mercado Pago'}</button>}
                {activeOrder.paymentMethod === 'GOCUOTAS' && activeOrder.cancellationRequest.status !== 'REFUNDED' && (activeOrder.paymentAttempts || []).some((payment) => payment.provider === 'GOCUOTAS' && payment.status === 'APPROVED') && <button type="button" className="admin-primary" disabled={refundProcessing} onClick={() => void confirmGoCuotasRefund(activeOrder)}>{refundProcessing ? 'Registrando...' : 'Registrar reintegro ya realizado en GOcuotas'}</button>}
                {activeOrder.paymentMethod === 'CASH' && activeOrder.cancellationRequest.status !== 'REFUNDED' && (activeOrder.paymentReceivedAt ? <button type="button" className="admin-primary" disabled={refundProcessing} onClick={() => void confirmCashRefund(activeOrder)}>{refundProcessing ? 'Registrando...' : 'Registrar reintegro en efectivo ya realizado'}</button> : <button type="button" className="admin-primary" disabled={refundProcessing} onClick={() => void resolveUnpaidCashOrder(activeOrder)}>Confirmar que no se recibió el pago</button>)}
                {activeOrder.cancellationRequest.returnStatus === 'RETURN_PENDING' && <button type="button" className="admin-primary" disabled={refundProcessing} onClick={() => void markReturnReceived(activeOrder)}>Registrar recepción física</button>}
                {activeOrder.cancellationRequest.returnStatus === 'RETURN_RECEIVED' && <button type="button" className="admin-primary" disabled={refundProcessing} onClick={() => void acceptReturn(activeOrder)}>Aceptar devolución y reponer stock</button>}
              </div>
              <p className="order-payment-empty">{activeOrder.paymentMethod === 'GOCUOTAS' ? 'GOcuotas no tiene un endpoint de reintegro documentado en la integración utilizada. Ejecutá primero la devolución en el proveedor y registrá la confirmación después de verificarla.' : activeOrder.paymentMethod === 'CASH' ? 'Registrá el reintegro solo después de devolver efectivamente el dinero y conservá la referencia del comprobante.' : 'Mercado Pago procesa el reintegro. Si el pedido ya fue despachado, registrá la recepción e inspección física antes de reingresar el producto al stock.'}</p>
            </section>}
            <section className="order-fiscal-card">
              <div className="order-fiscal-heading"><div><span className="admin-kicker">ARCA · HOMOLOGACIÓN</span><h3>Factura C</h3></div><small>Emisión manual de prueba</small></div>
              {(activeOrder.fiscalDocuments || []).filter((document) => document.type === 'INVOICE_C').map((document) => <div className={`order-fiscal-document ${document.status.toLowerCase()}`} key={document.id}>
                <div><strong>{document.status === 'AUTHORIZED' ? 'Autorizada' : document.status === 'REJECTED' ? 'Rechazada' : document.status === 'UNKNOWN' ? 'Pendiente de conciliación' : 'Emisión en curso'}</strong><small>{document.pointOfSale ? `Punto de venta ${document.pointOfSale}` : ''}{document.voucherNumber ? ` · Comprobante ${String(document.voucherNumber).padStart(8, '0')}` : ''}</small></div>
                {document.cae && <div><span>CAE</span><strong>{document.cae}</strong><small>Vencimiento: {document.caeExpiresAt ? formatDate(document.caeExpiresAt) : 'No informado'}</small></div>}
                {document.status === 'AUTHORIZED' && <button type="button" className="admin-quiet-button" disabled={invoiceDownloadingId === document.id || invoiceDownloadingId !== null} onClick={() => void downloadInvoicePdf(activeOrder.code, document.id)}>{invoiceDownloadingId === document.id ? 'Generando PDF...' : 'Descargar factura PDF'}</button>}
                {document.lastErrorMessage && <p>{document.lastErrorMessage}</p>}
                {['ISSUING', 'UNKNOWN', 'PENDING'].includes(document.status) && <button type="button" className="admin-quiet-button" disabled={invoiceIssuing} onClick={() => void reconcileInvoiceC(activeOrder, document.id)}>{invoiceIssuing ? 'Consultando ARCA...' : 'Conciliar con ARCA'}</button>}
              </div>)}
              {!(activeOrder.fiscalDocuments || []).some((document) => document.type === 'INVOICE_C' && ['AUTHORIZED', 'ISSUING', 'UNKNOWN', 'PENDING'].includes(document.status)) && activeOrder.status !== 'PENDING' && activeOrder.status !== 'CANCELLED' && (
                <form className="order-fiscal-form" onSubmit={(event) => void issueInvoiceC(activeOrder, event)}>
                  <p>Emití solo después de verificar el cobro. La prueba se realiza en homologación y no genera una factura fiscal válida para el comprador.</p>
                  <div className="order-fiscal-grid">
                    <label>Tipo de documento ARCA<input type="number" min="1" max="99" value={invoiceDocumentType} onChange={(event) => setInvoiceDocumentType(event.target.value)} required /></label>
                    <label>Número de documento<input inputMode="numeric" value={invoiceDocumentNumber} onChange={(event) => setInvoiceDocumentNumber(event.target.value)} required /></label>
                    <label>Condición IVA receptor (ID ARCA)<input type="number" min="1" value={invoiceVatCondition} onChange={(event) => setInvoiceVatCondition(event.target.value)} placeholder="Consultar en ARCA" required /></label>
                    <label>Nombre receptor<input value={invoiceReceiverName || activeOrder.customerName} onChange={(event) => setInvoiceReceiverName(event.target.value)} maxLength={200} /></label>
                    <label className="order-fiscal-full">Domicilio receptor<input value={invoiceReceiverAddress || [activeOrder.addressLine, activeOrder.city, activeOrder.province, activeOrder.postalCode].filter(Boolean).join(', ')} onChange={(event) => setInvoiceReceiverAddress(event.target.value)} maxLength={300} /></label>
                  </div>
                  <label className="order-fiscal-confirm"><input type="checkbox" checked={invoicePaymentConfirmed} onChange={(event) => setInvoicePaymentConfirmed(event.target.checked)} /> Confirmo que verifiqué que este pedido está cobrado.</label>
                  <button className="admin-primary" disabled={invoiceIssuing || !invoicePaymentConfirmed}>{invoiceIssuing ? 'Solicitando autorización...' : 'Emitir Factura C de prueba'}</button>
                </form>
              )}
              {(activeOrder.fiscalDocuments || []).some((document) => document.type === 'INVOICE_C' && ['ISSUING', 'UNKNOWN', 'PENDING'].includes(document.status)) && <p className="order-fiscal-warning">Hay una solicitud sin resultado concluyente. La emisión está bloqueada para evitar duplicados; primero hay que consultar y conciliar el comprobante con ARCA.</p>}
              {activeOrder.status === 'PENDING' && <p className="order-fiscal-help">Primero confirmá el pedido y verificá el pago.</p>}
            </section>
            {activeOrder.deliveryMethod !== 'PICKUP' && activeOrder.shippingCarrier && <div className="order-shipping-meta"><span>OPERADOR</span><strong>{activeOrder.shippingCarrier}</strong>{activeOrder.shippingService && <><span>SERVICIO</span><strong>{activeOrder.shippingService}</strong></>}{activeOrder.shippingEstimatedHours && <><span>PLAZO ESTIMADO</span><strong>{Math.ceil(activeOrder.shippingEstimatedHours / 24)} días</strong></>}{activeOrder.trackingCode && <><span>SEGUIMIENTO</span><strong>{activeOrder.trackingCode}</strong></>}</div>}
            {activeOrder.deliveryMethod === 'LOCAL_DELIVERY' && activeOrder.shippingInternalCostArs !== null && <section className="order-logistics-breakdown"><div><span className="admin-kicker">INFORMACIÓN INTERNA · SOLO ADMINISTRACIÓN</span><h3>Costo estimado de entrega local</h3></div><div className="order-logistics-summary"><span>Costo interno estimado</span><strong>{formatPrice(activeOrder.shippingInternalCostArs)}</strong><small>Importe configurado para esta modalidad; no es una liquidación definitiva.</small></div></section>}
            {activeOrder.shippingCostOptions && <section className="order-logistics-breakdown">
              <div><span className="admin-kicker">INFORMACIÓN INTERNA · SOLO ADMINISTRACIÓN</span><h3>Desglose de costos logísticos</h3><p>El comprador solo ve el precio de envío. Estos son los costos estimados que OCA informa para la tienda.</p></div>
              <div className="order-logistics-summary"><span>Precio cobrado al cliente</span><strong>{formatPrice(activeOrder.shippingCostOptions.priceArs ?? activeOrder.shippingCostArs ?? 0)}</strong></div>
              {activeOrder.shippingCostOptions.sellerOptions?.length ? <div className="order-logistics-table"><div className="order-logistics-row order-logistics-head"><span>Transportista</span><span>Costo tienda</span><span>Diferencia estimada</span></div>{activeOrder.shippingCostOptions.sellerOptions.map((option) => <div className="order-logistics-row" key={option.carrierId}><span><strong>{option.carrierName}</strong><small>{option.fulfillmentMode === 'D' ? 'Retiro en depósito' : 'Despacho en sucursal'}{option.estimatedHours ? ` · ${Math.ceil(option.estimatedHours / 24)} días` : ''}</small></span><strong>{formatPrice(option.costArs)}</strong><strong className={((activeOrder.shippingCostOptions?.priceArs ?? 0) - option.costArs) >= 0 ? 'order-logistics-positive' : 'order-logistics-negative'}>{formatPrice((activeOrder.shippingCostOptions?.priceArs ?? 0) - option.costArs)}</strong></div>)}</div> : <p className="order-logistics-unavailable">OCA no devolvió costos por transportista para esta cotización. El precio al cliente sí quedó registrado.</p>}
              <p className="order-logistics-footnote">La diferencia es un margen logístico estimado, no una ganancia neta. El costo definitivo puede variar al generar la etiqueta.</p>
            </section>}
            {(activeOrder.deliveryMethod === 'OCA' || activeOrder.deliveryMethod === 'ANDREANI') && activeOrder.status !== 'CANCELLED' && <form className="order-shipping-form" key={`${activeOrder.id}-${activeOrder.shippingCostArs}-${activeOrder.shippingCarrier}-${activeOrder.trackingCode}`} onSubmit={(event) => void saveShipping(event, activeOrder)}>
              <div><span className="admin-kicker">LOGÍSTICA NACIONAL</span><h3>Cotizar envío y seguimiento</h3><p>Este importe es el que se suma al total del comprador. El costo de OCA se gestionará por separado del importe cobrado al comprador.</p></div>
              <div className="order-shipping-fields">
                <label>Precio de envío cobrado al cliente (ARS)<input name="shippingCostArs" type="number" min="0" max="2000000000" step="1" required defaultValue={activeOrder.shippingCostArs ?? ''} placeholder="Ej. 8500" /></label>
                <label>Correo / transporte<input name="shippingCarrier" maxLength={100} defaultValue={activeOrder.shippingCarrier ?? ''} placeholder="Ej. Correo Argentino" /></label>
                <label className="tracking-field">Código de seguimiento<input name="trackingCode" maxLength={120} defaultValue={activeOrder.trackingCode ?? ''} placeholder="Código de envío" /></label>
              </div>
              <button className="admin-primary" type="submit" disabled={shippingSaving}>{shippingSaving ? 'Guardando envío...' : 'Guardar cotización y seguimiento'}</button>
            </form>}
            {activeOrder.deliveryMethod === 'LOCAL_DELIVERY' && activeOrder.status !== 'CANCELLED' && <form className="order-shipping-form" key={`${activeOrder.id}-local-delivery`} onSubmit={(event) => void saveShipping(event, activeOrder)}>
              <div><span className="admin-kicker">ENTREGA LOCAL</span><h3>Datos de entrega (todos opcionales)</h3><p>Si la entrega la hacés vos, no necesitás completar nada. Registrá cadetería, Uber o una referencia solo cuando te resulte útil.</p></div>
              <div className="order-shipping-fields">
                <label>Medio de entrega<input name="shippingCarrier" maxLength={100} defaultValue={activeOrder.shippingCarrier ?? ''} placeholder="Ej. Propia, cadetería, Uber..." /></label>
                <label className="tracking-field">Referencia / identificación<input name="trackingCode" maxLength={120} defaultValue={activeOrder.trackingCode ?? ''} placeholder="Ej. nombre del cadete o referencia" /></label>
                <label className="tracking-field">Observación (opcional)<input name="deliveryNote" maxLength={500} placeholder="Ej. Entrega coordinada para la tarde" /></label>
              </div>
              <button className="admin-primary" type="submit" disabled={shippingSaving}>{shippingSaving ? 'Guardando...' : 'Guardar datos de entrega'}</button>
            </form>}
            {activeOrder.deliveryMethod === 'LOCAL_DELIVERY' && activeOrder.shippingService === 'A coordinar' && activeOrder.shippingCostArs === null && ['PENDING', 'CONFIRMED', 'PREPARING'].includes(activeOrder.status) && <form className="order-shipping-form" key={`${activeOrder.id}-local-coordinate`} onSubmit={(event) => void saveShipping(event, activeOrder)}>
              <div><span className="admin-kicker">ENTREGA LOCAL</span><h3>Registrar costo acordado</h3><p>Ingresá el importe que se coordinó con el comprador. Se sumará al total final del pedido; no requiere transportista ni seguimiento.</p></div>
              <div className="order-shipping-fields">
                <label>Precio de entrega acordado (ARS)<input name="shippingCostArs" type="number" min="0" max="2000000000" step="1" required placeholder="Ej. 2500" /></label>
              </div>
              <button className="admin-primary" type="submit" disabled={shippingSaving}>{shippingSaving ? 'Guardando costo...' : 'Guardar costo acordado'}</button>
            </form>}
            {['OCA', 'ANDREANI'].includes(activeOrder.deliveryMethod) && activeOrder.status !== 'CANCELLED' && <section className="order-logistics-breakdown">
              <div><span className="admin-kicker">{activeOrder.deliveryMethod === 'ANDREANI' ? 'ANDREANI' : 'OCA E-PAK'}</span><h3>Despacho nacional</h3></div>
              <p>{activeOrder.deliveryMethod === 'ANDREANI' ? 'La cotización se realiza con Andreani. La admisión, descarga de etiqueta y seguimiento se habilitarán cuando se valide el contrato y el flujo de la cuenta.' : 'La cotización se realiza con OCA. La admisión, descarga de etiqueta y seguimiento se completarán cuando estén confirmados el número de cuenta, centro de costo y modalidad de despacho de la cuenta.'}</p>
            </section>}
            <div className="order-history"><h3>Historial de actividad</h3>{activeOrder.history.map((entry) => <div key={entry.id}><span>{historyEventLabel(entry)}{entry.fromStatus === entry.toStatus && <small>El pedido continúa {statusLabels[entry.toStatus].toLowerCase()}</small>}<small>{entry.note || 'Sin observaciones'}{entry.changedByAdmin?.email ? ` · ${entry.changedByAdmin.email}` : ''}</small></span><time>{formatDate(entry.createdAt)}</time></div>)}</div>
            {availableNextStatuses(activeOrder).length > 0 && <div className="order-update-status"><label>Observación (opcional)<input value={note} onChange={(event) => setNote(event.target.value)} maxLength={500} placeholder="Ej. Cliente contactado, envío coordinado..." /></label><div>{availableNextStatuses(activeOrder).map((next) => <button key={next} disabled={updating} className={next === 'CANCELLED' ? 'order-cancel-button' : 'admin-primary'} onClick={() => void changeStatus(activeOrder, next)}>{updating ? 'Actualizando...' : next === 'CANCELLED' ? 'Cancelar pedido' : activeOrder.deliveryMethod === 'LOCAL_DELIVERY' && activeOrder.shippingService === 'A coordinar' && activeOrder.status === 'PENDING' && next === 'CONFIRMED' ? 'Confirmar costo y continuar' : `Marcar: ${statusLabels[next]}`}</button>)}</div></div>}
          </section>}
          <p className="admin-footnote">Los pedidos admiten retiro, entrega local y envío nacional por OCA según la configuración. Mercado Pago solo estará disponible cuando sus credenciales y notificaciones estén configuradas.</p>
        </section>
      </main>
      {printKind && printOrders.length > 0 && <section className={`order-print-area ${printKind === 'receipt' ? 'receipt-print' : 'prep-print'}`} aria-hidden="true">
        {printOrders.map((order) => <article className="print-sheet" key={order.id}>
          <header><strong>Tu TiendaVM</strong><span>{printKind === 'receipt' ? 'COMPROBANTE DE PEDIDO' : 'PREPARACIÓN DE PEDIDO'}</span></header>
          <div className="print-order-code"><strong>{order.code}</strong><span>{formatDate(order.createdAt)}</span></div>
          <section><h2>{order.customerName}</h2><p>{order.customerPhone}{order.customerEmail ? ` · ${order.customerEmail}` : ''}</p><p>{[order.addressLine, order.city, order.province, order.postalCode].filter(Boolean).join(' · ')}</p></section>
          {order.customerNotes && <section className="print-notes"><strong>Observaciones del comprador</strong><p>{order.customerNotes}</p></section>}
          <table><thead><tr><th>CANT.</th><th>PRODUCTO</th><th>SKU</th>{printKind === 'receipt' && <th>IMPORTE</th>}</tr></thead><tbody>{order.items.map((item) => <tr key={item.id}><td>{item.quantity}</td><td>{item.productName}</td><td>{item.productSku}</td>{printKind === 'receipt' && <td>{formatPrice(item.lineTotalArs)}</td>}</tr>)}</tbody></table>
          {printKind === 'receipt' ? <><section className="print-payment"><p>Medio de pago: <strong>{order.paymentMethod === 'CASH' ? 'Efectivo' : order.paymentMethod === 'GOCUOTAS' ? 'GOcuotas' : 'Mercado Pago'}</strong></p><p>Estado del pedido: <strong>{statusLabels[order.status]}</strong></p>{order.paymentSurchargeArs > 0 && <p>Recargo por medio de pago: <strong>{formatPrice(order.paymentSurchargeArs)}</strong></p>}<p>Estado del cobro: <strong>{order.paymentAttempts?.some((payment) => payment.status === 'APPROVED') ? 'Pago aprobado' : order.paymentMethod === 'CASH' ? 'Pago en efectivo pendiente de confirmar' : order.paymentAttempts?.[0] ? order.paymentAttempts[0].status === 'REJECTED' ? 'Pago rechazado' : order.paymentAttempts[0].status === 'CANCELLED' ? 'Pago cancelado' : 'Pago pendiente de confirmación' : 'Sin pago registrado'}</strong></p></section><div className="print-totals"><p>Subtotal: <strong>{formatPrice(order.subtotalArs)}</strong></p><p>Entrega: <strong>{order.shippingCostArs === null ? 'A coordinar' : formatPrice(order.shippingCostArs)}</strong></p>{order.paymentSurchargeArs > 0 && <p>Recargo: <strong>{formatPrice(order.paymentSurchargeArs)}</strong></p>}<p className="print-grand-total">TOTAL: <strong>{order.totalArs === null ? 'Pendiente de coordinación' : formatPrice(order.totalArs)}</strong></p></div></> : <div className="print-checklist"><strong>CONTROL DE PREPARACIÓN</strong>{order.items.map((item) => <p key={item.id}>□ {item.quantity} × {item.productName} <span>SKU: {item.productSku}</span></p>)}</div>}
          <footer>{order.deliveryMethod === 'PICKUP' ? 'Retiro por domicilio del vendedor' : order.deliveryMethod === 'LOCAL_DELIVERY' ? 'Entrega local' : order.deliveryMethod === 'LEGACY_CARRIER' ? 'Proveedor anterior (histórico)' : 'OCA'} · Estado: {statusLabels[order.status]}{order.trackingCode ? ` · Seguimiento: ${order.trackingCode}` : ''}</footer>
        </article>)}
      </section>}
    </div>
  )
}
