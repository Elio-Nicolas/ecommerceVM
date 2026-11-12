import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { formatPrice } from './products'
import './order-logistics.css'

const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:7381').replace(/\/$/, '')
const TOKEN_KEY = 'ecommercevm_admin_token'

type OrderStatus = 'PENDING' | 'CONFIRMED' | 'PREPARING' | 'SHIPPED' | 'DELIVERED' | 'CANCELLED'
type OrderItem = { id: string; productName: string; productSku: string; unitPriceArs: number; quantity: number; lineTotalArs: number }
type EnviopackPackage = { alto: number; ancho: number; largo: number; peso: number; descripcion_primera_linea?: string; descripcion_segunda_linea?: string }
type OrderHistory = { id: string; fromStatus: OrderStatus | null; toStatus: OrderStatus; note: string | null; createdAt: string; changedByAdmin?: { email: string } | null }
type Order = {
  id: string; code: string; status: OrderStatus; customerName: string; customerEmail: string | null
  customerPhone: string; addressLine: string; city: string; province: string; postalCode: string | null
  customerNotes: string | null; subtotalArs: number; shippingCostArs: number | null; totalArs: number | null
  shippingCarrier: string | null; trackingCode: string | null; shippingService: string | null; shippingEstimatedHours: number | null
  deliveryMethod: 'ENVIOPACK' | 'LOCAL_DELIVERY' | 'PICKUP'; shippingInternalCostArs: number | null; deliveryInstructions: string | null
  shippingCostOptions: { priceArs?: number; serviceCode?: string; sellerCostStatus?: 'AVAILABLE' | 'UNAVAILABLE'; sellerOptions?: { carrierId: string; carrierName: string; costArs: number; estimatedHours: number | null; fulfillmentMode: string }[] } | null
  enviopackOrderId: string | null; enviopackShipmentId: string | null; enviopackShipmentStatus: string | null
  enviopackTrackingNumber: string | null; enviopackProcessedAt: string | null; enviopackPackages: EnviopackPackage[] | null; enviopackLabelSavedAt: string | null
  createdAt: string; items: OrderItem[]; history: OrderHistory[]
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

function availableNextStatuses(order: Order): OrderStatus[] {
  const mpStatuses = (order.paymentAttempts || []).filter((payment) => payment.provider === 'MERCADO_PAGO').map((payment) => payment.status)
  if (order.status === 'PENDING' && mpStatuses.some((status) => ['CREATING', 'PENDING', 'UNKNOWN'].includes(status))) return []
  if (mpStatuses.includes('PARTIALLY_REFUNDED')) return []
  if (mpStatuses.includes('REFUNDED')) return nextStatuses[order.status].includes('CANCELLED') ? ['CANCELLED'] : []
  if (mpStatuses.includes('APPROVED')) return nextStatuses[order.status].filter((status) => status !== 'CANCELLED')
  if (order.status === 'PENDING' && order.deliveryMethod === 'LOCAL_DELIVERY' && order.shippingService === 'A coordinar' && order.shippingCostArs === null) return ['CANCELLED']
  if (order.status === 'PREPARING' && order.deliveryMethod === 'PICKUP') return ['DELIVERED', 'CANCELLED']
  if (order.status === 'PREPARING' && order.deliveryMethod === 'ENVIOPACK' && order.enviopackShipmentStatus !== 'P') return ['CANCELLED']
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
  const [packageCount, setPackageCount] = useState(1)
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
    const frame = window.requestAnimationFrame(() => window.print())
    return () => window.cancelAnimationFrame(frame)
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
    setError('')
    setNotice('')
    try {
      await request(`/payments/admin/orders/${order.id}/attempts/${attemptId}/reconcile`, token, { method: 'POST' })
      setNotice(`Estado del pago del pedido ${order.code} actualizado desde Mercado Pago.`)
      await loadOrders(token)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo consultar el pago en Mercado Pago.')
    } finally {
      setPaymentReconcilingId(null)
    }
  }

  async function saveShipping(event: FormEvent<HTMLFormElement>, order: Order) {
    event.preventDefault()
    if (!token || shippingSaving) return
    const formData = new FormData(event.currentTarget)
    const shippingCostArs = Number(formData.get('shippingCostArs'))
    if (!Number.isSafeInteger(shippingCostArs) || shippingCostArs < 0) {
      setError('Ingresá un costo de envío válido.')
      return
    }
    setShippingSaving(true)
    setError('')
    setNotice('')
    try {
      await request(`/admin/orders/${order.id}/shipping`, token, {
        method: 'PATCH',
        body: JSON.stringify({
          shippingCostArs,
          shippingCarrier: String(formData.get('shippingCarrier') || '').trim() || null,
          trackingCode: String(formData.get('trackingCode') || '').trim() || null,
        }),
      })
      setNotice(`Costo de entrega del pedido ${order.code} registrado. Total actualizado: ${formatPrice(order.subtotalArs + shippingCostArs)}. Ahora confirmá el costo para continuar.`)
      await loadOrders(token)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo actualizar el envío.')
    } finally {
      setShippingSaving(false)
    }
  }

  async function createEnviopack(order: Order, carrierId: string, packages: { alto: number; ancho: number; largo: number; peso: number }[]) {
    if (!token || shippingSaving || !carrierId || packages.length < 1) return
    setShippingSaving(true); setError(''); setNotice('')
    try {
      const result = await request<{ data: { shipmentId: string; status: string }; message: string }>(`/admin/enviopack/orders/${order.id}/create`, token, {
        method: 'POST', body: JSON.stringify({ carrierId, packages }),
      })
      setNotice(result.message)
      await loadOrders(token)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo crear el envío en Envíopack.')
    } finally { setShippingSaving(false) }
  }

  async function refreshEnviopack(order: Order) {
    if (!token || shippingSaving) return
    setShippingSaving(true); setError(''); setNotice('')
    try {
      await request(`/admin/enviopack/orders/${order.id}/refresh`, token, { method: 'POST' })
      setNotice('Estado del envío actualizado desde Envíopack.')
      await loadOrders(token)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo consultar Envíopack.')
    } finally { setShippingSaving(false) }
  }

  async function downloadEnviopackLabel(order: Order) {
    if (!token || shippingSaving) return
    setShippingSaving(true); setError('')
    try {
      const response = await fetch(`${API_URL}/api/v1/admin/enviopack/orders/${order.id}/label`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}))
        throw new Error(payload?.error?.message || 'No se pudo descargar la etiqueta.')
      }
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url; anchor.download = `etiqueta-${order.code}.pdf`
      document.body.appendChild(anchor); anchor.click(); anchor.remove()
      URL.revokeObjectURL(url)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo descargar la etiqueta.')
    } finally { setShippingSaving(false) }
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
        <a className="admin-brand" href="/"><span className="admin-brand-mark">eV</span><span>ecommerce<span>VM</span></span></a>
        <div className="admin-nav-label">GESTIÓN</div>
        <a className="admin-nav-item" href="/admin"><span className="admin-nav-icon">▦</span> Productos</a>
        <a className="admin-nav-item active" href="/admin/pedidos"><span className="admin-nav-icon">▤</span> Pedidos</a>
        <div className="admin-sidebar-bottom"><span className="admin-avatar">A</span><div><strong>Sesión administrativa</strong><small>Administrador</small></div><button onClick={() => { setToken(''); localStorage.removeItem(TOKEN_KEY); window.location.replace('/admin') }} title="Cerrar sesión">↗</button></div>
      </aside>

      <main className="admin-main">
        <header className="admin-topbar"><div><span>ECOMMERCEVM / ADMINISTRACIÓN</span><h1>Pedidos</h1></div><a href="/" className="admin-store-link">Ver tienda ↗</a></header>
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
                  <td><button className="order-detail-button" onClick={() => { setSelected(selected === order.id ? null : order.id); setNote(''); setPackageCount(order.enviopackPackages?.length || 1); setInvoiceReceiverName(''); setInvoiceReceiverAddress(''); setInvoicePaymentConfirmed(false) }}>{selected === order.id ? 'Cerrar' : 'Ver pedido'}</button></td>
                </tr>)}
              </tbody></table></div>
            )}
            <div className="admin-table-footer order-pagination"><span>Mostrando {orders.length} de {total} pedidos</span><div><button disabled={page <= 1 || loading} onClick={() => { setPrintSelection([]); setPage((value) => value - 1) }}>Anterior</button><span>{page} / {totalPages}</span><button disabled={page >= totalPages || loading} onClick={() => { setPrintSelection([]); setPage((value) => value + 1) }}>Siguiente</button></div></div>
          </div>

          {activeOrder && <section className="order-detail-card">
            <div className="admin-form-heading"><div><span className="admin-kicker">PEDIDO {activeOrder.code}</span><h2>Detalle del pedido</h2></div><div className="admin-category-actions"><button type="button" className="admin-quiet-button" onClick={() => printCurrentOrder(activeOrder, 'receipt')}>Imprimir ticket</button><button type="button" className="admin-quiet-button" onClick={() => printCurrentOrder(activeOrder, 'prep')}>Etiqueta de preparación</button><button className="admin-quiet-button" onClick={() => setSelected(null)}>Cerrar</button></div></div>
            <div className="order-detail-grid">
              <div><span>CLIENTE</span><strong>{activeOrder.customerName}</strong><small>{activeOrder.customerPhone}</small><small>{activeOrder.customerEmail || 'Sin correo informado'}</small></div>
              <div><span>MODALIDAD DE ENTREGA</span><strong>{activeOrder.deliveryMethod === 'PICKUP' ? 'Retiro por domicilio del vendedor' : activeOrder.deliveryMethod === 'LOCAL_DELIVERY' ? 'Entrega local' : 'Envíopack'}</strong><small>{activeOrder.deliveryInstructions || [activeOrder.addressLine, activeOrder.city, activeOrder.province, activeOrder.postalCode].filter(Boolean).join(' · ')}</small></div>
              <div><span>NOTAS</span><strong>{activeOrder.customerNotes || 'Sin indicaciones adicionales'}</strong></div>
            </div>
            <div className="order-items-list"><h3>Productos</h3>{activeOrder.items.map((item) => <div key={item.id}><span>{item.quantity} × {item.productName}<small>{item.productSku} · {formatPrice(item.unitPriceArs)} c/u</small></span><strong>{formatPrice(item.lineTotalArs)}</strong></div>)}</div>
            <div className="order-totals"><span>Subtotal</span><strong>{formatPrice(activeOrder.subtotalArs)}</strong><small>{activeOrder.shippingCostArs === null ? 'Envío: pendiente de coordinación' : `Envío: ${formatPrice(activeOrder.shippingCostArs)}`}</small><span>Total del pedido</span><strong>{activeOrder.totalArs === null ? 'Pendiente de coordinación' : formatPrice(activeOrder.totalArs)}</strong></div>
            <section className="order-payment-card">
              <div className="order-payment-heading"><div><span className="admin-kicker">COBROS ONLINE</span><h3>Mercado Pago</h3></div><small>Estado verificado por Webhook</small></div>
              {(activeOrder.paymentAttempts || []).map((payment) => <div className="order-payment-attempt" key={payment.id}>
                <div><strong>{payment.status === 'APPROVED' ? 'Pago aprobado' : payment.status === 'REJECTED' ? 'Pago rechazado' : payment.status === 'CANCELLED' ? 'Pago cancelado' : payment.status === 'REFUNDED' ? 'Pago reembolsado' : payment.status === 'PARTIALLY_REFUNDED' ? 'Reembolso parcial' : payment.status === 'UNKNOWN' ? 'Resultado incierto' : payment.status === 'CREATING' ? 'Creando pago' : 'Pago pendiente'}</strong><small>{payment.statusDetail || 'Sin detalle informado'} · {formatDate(payment.createdAt)}</small></div>
                <strong>{formatPrice(payment.amountArs)}</strong>
                {payment.providerOrderId && <small className="order-payment-reference">Orden Mercado Pago: {payment.providerOrderId}</small>}
                {payment.approvedAt && <small className="order-payment-reference">Aprobado: {formatDate(payment.approvedAt)}</small>}
                {payment.providerOrderId && ['CREATING', 'PENDING', 'UNKNOWN', 'APPROVED', 'PARTIALLY_REFUNDED'].includes(payment.status) && <button type="button" className="admin-quiet-button" disabled={paymentReconcilingId !== null} onClick={() => void reconcilePayment(activeOrder, payment.id)}>{paymentReconcilingId === payment.id ? 'Consultando Mercado Pago...' : 'Conciliar pago'}</button>}
              </div>)}
              {!(activeOrder.paymentAttempts || []).length && <p className="order-payment-empty">Este pedido no tiene intentos de pago online registrados.</p>}
            </section>
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
              <div><span className="admin-kicker">INFORMACIÓN INTERNA · SOLO ADMINISTRACIÓN</span><h3>Desglose de costos logísticos</h3><p>El comprador solo ve el precio de envío. Estos son los costos estimados que Envíopack informa para la tienda.</p></div>
              <div className="order-logistics-summary"><span>Precio cobrado al cliente</span><strong>{formatPrice(activeOrder.shippingCostOptions.priceArs ?? activeOrder.shippingCostArs ?? 0)}</strong></div>
              {activeOrder.shippingCostOptions.sellerOptions?.length ? <div className="order-logistics-table"><div className="order-logistics-row order-logistics-head"><span>Transportista</span><span>Costo tienda</span><span>Diferencia estimada</span></div>{activeOrder.shippingCostOptions.sellerOptions.map((option) => <div className="order-logistics-row" key={option.carrierId}><span><strong>{option.carrierName}</strong><small>{option.fulfillmentMode === 'D' ? 'Retiro en depósito' : 'Despacho en sucursal'}{option.estimatedHours ? ` · ${Math.ceil(option.estimatedHours / 24)} días` : ''}</small></span><strong>{formatPrice(option.costArs)}</strong><strong className={((activeOrder.shippingCostOptions?.priceArs ?? 0) - option.costArs) >= 0 ? 'order-logistics-positive' : 'order-logistics-negative'}>{formatPrice((activeOrder.shippingCostOptions?.priceArs ?? 0) - option.costArs)}</strong></div>)}</div> : <p className="order-logistics-unavailable">Envíopack no devolvió costos por transportista para esta cotización. El precio al cliente sí quedó registrado.</p>}
              <p className="order-logistics-footnote">La diferencia es un margen logístico estimado, no una ganancia neta. El costo definitivo puede variar al generar la etiqueta.</p>
            </section>}
            {activeOrder.deliveryMethod === 'ENVIOPACK' && activeOrder.status !== 'CANCELLED' && <form className="order-shipping-form" key={`${activeOrder.id}-${activeOrder.shippingCostArs}-${activeOrder.shippingCarrier}-${activeOrder.trackingCode}`} onSubmit={(event) => void saveShipping(event, activeOrder)}>
              <div><span className="admin-kicker">LOGÍSTICA NACIONAL</span><h3>Cotizar envío y seguimiento</h3><p>Este importe es el que se suma al total del comprador. El costo que cobra Envíopack se consulta y se muestra por separado en el desglose interno.</p></div>
              <div className="order-shipping-fields">
                <label>Precio de envío cobrado al cliente (ARS)<input name="shippingCostArs" type="number" min="0" max="2000000000" step="1" required defaultValue={activeOrder.shippingCostArs ?? ''} placeholder="Ej. 8500" /></label>
                <label>Correo / transporte<input name="shippingCarrier" maxLength={100} defaultValue={activeOrder.shippingCarrier ?? ''} placeholder="Ej. Correo Argentino" /></label>
                <label className="tracking-field">Código de seguimiento<input name="trackingCode" maxLength={120} defaultValue={activeOrder.trackingCode ?? ''} placeholder="Código de envío" /></label>
              </div>
              <button className="admin-primary" type="submit" disabled={shippingSaving}>{shippingSaving ? 'Guardando envío...' : 'Guardar cotización y seguimiento'}</button>
            </form>}
            {activeOrder.deliveryMethod === 'LOCAL_DELIVERY' && activeOrder.shippingService === 'A coordinar' && activeOrder.shippingCostArs === null && ['PENDING', 'CONFIRMED', 'PREPARING'].includes(activeOrder.status) && <form className="order-shipping-form" key={`${activeOrder.id}-local-coordinate`} onSubmit={(event) => void saveShipping(event, activeOrder)}>
              <div><span className="admin-kicker">ENTREGA LOCAL</span><h3>Registrar costo acordado</h3><p>Ingresá el importe que se coordinó con el comprador. Se sumará al total final del pedido; no requiere transportista ni seguimiento.</p></div>
              <div className="order-shipping-fields">
                <label>Precio de entrega acordado (ARS)<input name="shippingCostArs" type="number" min="0" max="2000000000" step="1" required placeholder="Ej. 2500" /></label>
              </div>
              <button className="admin-primary" type="submit" disabled={shippingSaving}>{shippingSaving ? 'Guardando costo...' : 'Guardar costo acordado'}</button>
            </form>}
            {activeOrder.deliveryMethod === 'ENVIOPACK' && activeOrder.status !== 'CANCELLED' && <section className="order-logistics-breakdown">
              <div><span className="admin-kicker">ENVÍOPACK</span><h3>Generación de envío y etiqueta</h3></div>
              {activeOrder.enviopackShipmentId ? <div className="order-logistics-summary">
                <span>Envío #{activeOrder.enviopackShipmentId} · Estado Envíopack: {activeOrder.enviopackShipmentStatus || 'Sin informar'}</span>
                {activeOrder.enviopackTrackingNumber && <strong>Seguimiento: {activeOrder.enviopackTrackingNumber}</strong>}{activeOrder.enviopackLabelSavedAt && <small>Etiqueta archivada para reimpresión · {formatDate(activeOrder.enviopackLabelSavedAt)}</small>}
                <div className="admin-category-actions">
                  <button type="button" className="admin-quiet-button" disabled={shippingSaving} onClick={() => void refreshEnviopack(activeOrder)}>Actualizar estado</button>
                  {(activeOrder.enviopackShipmentStatus === 'P' || activeOrder.enviopackLabelSavedAt) && <button type="button" className="admin-primary" disabled={shippingSaving} onClick={() => void downloadEnviopackLabel(activeOrder)}>Descargar etiqueta PDF</button>}
                </div>
                {Array.isArray(activeOrder.enviopackPackages) && <small>Bultos registrados: {activeOrder.enviopackPackages.length}</small>}
              </div> : activeOrder.status === 'PREPARING' ? <form className="order-shipping-form" onSubmit={(event) => {
                event.preventDefault()
                const data = new FormData(event.currentTarget)
                const packages = Array.from({ length: packageCount }, (_, index) => ({
                  alto: Number(data.get(`package-${index}-alto`)),
                  ancho: Number(data.get(`package-${index}-ancho`)),
                  largo: Number(data.get(`package-${index}-largo`)),
                  peso: Number(data.get(`package-${index}-peso`)),
                }))
                if (packages.some((item) => !Number.isInteger(item.alto) || !Number.isInteger(item.ancho) || !Number.isInteger(item.largo) || item.alto < 1 || item.ancho < 1 || item.largo < 1 || !Number.isFinite(item.peso) || item.peso <= 0)) {
                  setError('Completá las dimensiones en centímetros y el peso en kilogramos para cada bulto.')
                  return
                }
                void createEnviopack(activeOrder, String(data.get('carrierId') || ''), packages)
              }}>
                <p>Elegí el correo cotizado y indicá cómo preparaste físicamente el pedido. Cada fila representa un bulto real; no se genera un paquete por cada unidad comprada.</p>{activeOrder.enviopackPackages && !activeOrder.enviopackShipmentId && <p className="order-logistics-footnote">Hay bultos guardados de un intento anterior. Si Envíopack no llegó a crear el envío, podés corregirlos; si ya lo creó, el sistema recuperará el envío existente para evitar duplicados.</p>}
                {activeOrder.shippingCostOptions?.sellerOptions?.length ? <>
                  <label>Correo / operador
                    <select name="carrierId" required defaultValue="">
                      <option value="" disabled>Seleccionar transportista</option>
                      {activeOrder.shippingCostOptions.sellerOptions.map((option) => <option key={option.carrierId} value={option.carrierId}>{option.carrierName} · costo tienda {formatPrice(option.costArs)}</option>)}
                    </select>
                  </label>
                  <div className="order-shipping-fields">
                    {Array.from({ length: packageCount }, (_, index) => <div key={index} className="order-logistics-summary">
                      <strong>Bulto {index + 1}</strong>
                      <label>Alto (cm)<input name={`package-${index}-alto`} type="number" min="1" max="300" step="1" required readOnly={Boolean(activeOrder.enviopackShipmentId)} defaultValue={activeOrder.enviopackPackages?.[index]?.alto ?? ''} placeholder="Alto" /></label>
                      <label>Ancho (cm)<input name={`package-${index}-ancho`} type="number" min="1" max="300" step="1" required readOnly={Boolean(activeOrder.enviopackShipmentId)} defaultValue={activeOrder.enviopackPackages?.[index]?.ancho ?? ''} placeholder="Ancho" /></label>
                      <label>Largo (cm)<input name={`package-${index}-largo`} type="number" min="1" max="300" step="1" required readOnly={Boolean(activeOrder.enviopackShipmentId)} defaultValue={activeOrder.enviopackPackages?.[index]?.largo ?? ''} placeholder="Largo" /></label>
                      <label>Peso (kg)<input name={`package-${index}-peso`} type="number" min="0.01" max="1000" step="0.01" required readOnly={Boolean(activeOrder.enviopackShipmentId)} defaultValue={activeOrder.enviopackPackages?.[index]?.peso ?? ''} placeholder="Ej. 2.5" /></label>
                    </div>)}
                  </div>
                  <div className="admin-category-actions">
                    <button type="button" className="admin-quiet-button" disabled={Boolean(activeOrder.enviopackShipmentId) || packageCount <= 1 || shippingSaving} onClick={() => setPackageCount((count) => Math.max(1, count - 1))}>Quitar último bulto</button>
                    <button type="button" className="admin-quiet-button" disabled={Boolean(activeOrder.enviopackShipmentId) || packageCount >= 20 || shippingSaving} onClick={() => setPackageCount((count) => Math.min(20, count + 1))}>Agregar bulto</button>
                  </div>
                  <button className="admin-primary" disabled={shippingSaving}>{shippingSaving ? 'Creando envío...' : 'Crear envío en Envíopack'}</button>
                </> : <p className="order-logistics-unavailable">La cotización no guardó opciones de transportista con costo interno. No se puede generar el envío hasta contar con una opción válida.</p>}
              </form> : <p>Para generar el envío, primero pasá el pedido a En preparación.</p>}
            </section>}
            <div className="order-history"><h3>Historial de estados</h3>{activeOrder.history.map((entry) => <div key={entry.id}><span>{statusLabels[entry.toStatus]}<small>{entry.note || 'Sin observaciones'}{entry.changedByAdmin?.email ? ` · ${entry.changedByAdmin.email}` : ''}</small></span><time>{formatDate(entry.createdAt)}</time></div>)}</div>
            {availableNextStatuses(activeOrder).length > 0 && <div className="order-update-status"><label>Observación (opcional)<input value={note} onChange={(event) => setNote(event.target.value)} maxLength={500} placeholder="Ej. Cliente contactado, envío coordinado..." /></label><div>{availableNextStatuses(activeOrder).map((next) => <button key={next} disabled={updating} className={next === 'CANCELLED' ? 'order-cancel-button' : 'admin-primary'} onClick={() => void changeStatus(activeOrder, next)}>{updating ? 'Actualizando...' : next === 'CANCELLED' ? 'Cancelar pedido' : activeOrder.deliveryMethod === 'LOCAL_DELIVERY' && activeOrder.shippingService === 'A coordinar' && activeOrder.status === 'PENDING' && next === 'CONFIRMED' ? 'Confirmar costo y continuar' : `Marcar: ${statusLabels[next]}`}</button>)}</div></div>}
          </section>}
          <p className="admin-footnote">Los pedidos pueden registrarse con retiro, entrega local o Envíopack. El pago todavía no está habilitado.</p>
        </section>
      </main>
      {printKind && printOrders.length > 0 && <section className={`order-print-area ${printKind === 'receipt' ? 'receipt-print' : 'prep-print'}`} aria-hidden="true">
        {printOrders.map((order) => <article className="print-sheet" key={order.id}>
          <header><strong>ecommerceVM</strong><span>{printKind === 'receipt' ? 'COMPROBANTE DE PEDIDO' : 'PREPARACIÓN DE PEDIDO'}</span></header>
          <div className="print-order-code"><strong>{order.code}</strong><span>{formatDate(order.createdAt)}</span></div>
          <section><h2>{order.customerName}</h2><p>{order.customerPhone}{order.customerEmail ? ` · ${order.customerEmail}` : ''}</p><p>{[order.addressLine, order.city, order.province, order.postalCode].filter(Boolean).join(' · ')}</p></section>
          {order.customerNotes && <section className="print-notes"><strong>Observaciones del comprador</strong><p>{order.customerNotes}</p></section>}
          <table><thead><tr><th>CANT.</th><th>PRODUCTO</th><th>SKU</th>{printKind === 'receipt' && <th>IMPORTE</th>}</tr></thead><tbody>{order.items.map((item) => <tr key={item.id}><td>{item.quantity}</td><td>{item.productName}</td><td>{item.productSku}</td>{printKind === 'receipt' && <td>{formatPrice(item.lineTotalArs)}</td>}</tr>)}</tbody></table>
          {printKind === 'receipt' ? <div className="print-totals"><p>Subtotal: <strong>{formatPrice(order.subtotalArs)}</strong></p><p>Entrega: <strong>{order.shippingCostArs === null ? 'A coordinar' : formatPrice(order.shippingCostArs)}</strong></p><p className="print-grand-total">TOTAL: <strong>{order.totalArs === null ? 'Pendiente de coordinación' : formatPrice(order.totalArs)}</strong></p></div> : <div className="print-checklist"><strong>CONTROL DE PREPARACIÓN</strong>{order.items.map((item) => <p key={item.id}>□ {item.quantity} × {item.productName} <span>SKU: {item.productSku}</span></p>)}</div>}
          <footer>{order.deliveryMethod === 'PICKUP' ? 'Retiro por domicilio del vendedor' : order.deliveryMethod === 'LOCAL_DELIVERY' ? 'Entrega local' : 'Envíopack'} · Estado: {statusLabels[order.status]}{order.trackingCode ? ` · Seguimiento: ${order.trackingCode}` : ''}</footer>
        </article>)}
      </section>}
    </div>
  )
}
