import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { formatPrice } from './products'
import './order-logistics.css'

const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:7381').replace(/\/$/, '')
const TOKEN_KEY = 'ecommercevm_admin_token'

type OrderStatus = 'PENDING' | 'CONFIRMED' | 'PREPARING' | 'SHIPPED' | 'DELIVERED' | 'CANCELLED'
type OrderItem = { id: string; productName: string; productSku: string; unitPriceArs: number; quantity: number; lineTotalArs: number }
type OrderHistory = { id: string; fromStatus: OrderStatus | null; toStatus: OrderStatus; note: string | null; createdAt: string; changedByAdmin?: { email: string } | null }
type Order = {
  id: string; code: string; status: OrderStatus; customerName: string; customerEmail: string | null
  customerPhone: string; addressLine: string; city: string; province: string; postalCode: string | null
  customerNotes: string | null; subtotalArs: number; shippingCostArs: number | null; totalArs: number | null
  shippingCarrier: string | null; trackingCode: string | null; shippingService: string | null; shippingEstimatedHours: number | null
  deliveryMethod: 'ENVIOPACK' | 'LOCAL_DELIVERY' | 'PICKUP'; shippingInternalCostArs: number | null; deliveryInstructions: string | null
  shippingCostOptions: { priceArs?: number; sellerCostStatus?: 'AVAILABLE' | 'UNAVAILABLE'; sellerOptions?: { carrierId: string; carrierName: string; costArs: number; estimatedHours: number | null; fulfillmentMode: string }[] } | null
  createdAt: string; items: OrderItem[]; history: OrderHistory[]
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

  const loadOrders = useCallback(async (authToken: string) => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ page: String(page), limit: '20' })
      if (status !== 'ALL') params.set('status', status)
      if (search.trim()) params.set('q', search.trim())
      const result = await request<ApiResponse<Order[]>>(`/admin/orders?${params.toString()}`, authToken)
      setOrders(result.data)
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
      setNotice(`Envío del pedido ${order.code} actualizado. Total: ${formatPrice(order.subtotalArs + shippingCostArs)}.`)
      await loadOrders(token)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo actualizar el envío.')
    } finally {
      setShippingSaving(false)
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

  if (checking) return <div className="admin-loading">Verificando sesión...</div>

  const activeOrder = orders.find((order) => order.id === selected) || null

  return (
    <div className="admin-layout">
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
              <label className="admin-search"><span>⌕</span><input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1) }} placeholder="Buscar por código, cliente o teléfono..." /></label>
              <select value={status} onChange={(event) => { setStatus(event.target.value); setPage(1) }} aria-label="Filtrar por estado">
                <option value="ALL">Todos los estados</option>
                {Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </div>
            {loading ? <div className="admin-table-empty">Cargando pedidos...</div> : orders.length === 0 ? <div className="admin-table-empty">Todavía no hay pedidos para mostrar.</div> : (
              <div className="admin-table-scroll"><table className="admin-table order-table"><thead><tr><th>PEDIDO</th><th>CLIENTE</th><th>FECHA</th><th>ARTÍCULOS</th><th>SUBTOTAL</th><th>ESTADO</th><th>DETALLE</th></tr></thead><tbody>
                {orders.map((order) => <tr key={order.id}>
                  <td><strong>{order.code}</strong></td><td><strong>{order.customerName}</strong><small className="order-phone">{order.customerPhone}</small></td>
                  <td>{formatDate(order.createdAt)}</td><td>{order.items.reduce((sum, item) => sum + item.quantity, 0)}</td>
                  <td className="admin-price">{formatPrice(order.subtotalArs)}</td>
                  <td><span className={`admin-status order-status ${order.status.toLowerCase()}`}>{statusLabels[order.status]}</span></td>
                  <td><button className="order-detail-button" onClick={() => { setSelected(selected === order.id ? null : order.id); setNote('') }}>{selected === order.id ? 'Cerrar' : 'Ver pedido'}</button></td>
                </tr>)}
              </tbody></table></div>
            )}
            <div className="admin-table-footer order-pagination"><span>Mostrando {orders.length} de {total} pedidos</span><div><button disabled={page <= 1 || loading} onClick={() => setPage((value) => value - 1)}>Anterior</button><span>{page} / {totalPages}</span><button disabled={page >= totalPages || loading} onClick={() => setPage((value) => value + 1)}>Siguiente</button></div></div>
          </div>

          {activeOrder && <section className="order-detail-card">
            <div className="admin-form-heading"><div><span className="admin-kicker">PEDIDO {activeOrder.code}</span><h2>Detalle del pedido</h2></div><button className="admin-quiet-button" onClick={() => setSelected(null)}>Cerrar</button></div>
            <div className="order-detail-grid">
              <div><span>CLIENTE</span><strong>{activeOrder.customerName}</strong><small>{activeOrder.customerPhone}</small><small>{activeOrder.customerEmail || 'Sin correo informado'}</small></div>
              <div><span>MODALIDAD DE ENTREGA</span><strong>{activeOrder.deliveryMethod === 'PICKUP' ? 'Retiro por domicilio del vendedor' : activeOrder.deliveryMethod === 'LOCAL_DELIVERY' ? 'Entrega local' : 'Envíopack'}</strong><small>{activeOrder.deliveryInstructions || [activeOrder.addressLine, activeOrder.city, activeOrder.province, activeOrder.postalCode].filter(Boolean).join(' · ')}</small></div>
              <div><span>NOTAS</span><strong>{activeOrder.customerNotes || 'Sin indicaciones adicionales'}</strong></div>
            </div>
            <div className="order-items-list"><h3>Productos</h3>{activeOrder.items.map((item) => <div key={item.id}><span>{item.quantity} × {item.productName}<small>{item.productSku} · {formatPrice(item.unitPriceArs)} c/u</small></span><strong>{formatPrice(item.lineTotalArs)}</strong></div>)}</div>
            <div className="order-totals"><span>Subtotal</span><strong>{formatPrice(activeOrder.subtotalArs)}</strong><small>{activeOrder.shippingCostArs === null ? 'Envío: pendiente de cotización · Total final: pendiente' : `Envío: ${formatPrice(activeOrder.shippingCostArs)} · Total: ${formatPrice(activeOrder.totalArs ?? activeOrder.subtotalArs + activeOrder.shippingCostArs)}`}</small></div>
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
            <div className="order-history"><h3>Historial de estados</h3>{activeOrder.history.map((entry) => <div key={entry.id}><span>{statusLabels[entry.toStatus]}<small>{entry.note || 'Sin observaciones'}{entry.changedByAdmin?.email ? ` · ${entry.changedByAdmin.email}` : ''}</small></span><time>{formatDate(entry.createdAt)}</time></div>)}</div>
            {availableNextStatuses(activeOrder).length > 0 && <div className="order-update-status"><label>Observación (opcional)<input value={note} onChange={(event) => setNote(event.target.value)} maxLength={500} placeholder="Ej. Cliente contactado, envío coordinado..." /></label><div>{availableNextStatuses(activeOrder).map((next) => <button key={next} disabled={updating} className={next === 'CANCELLED' ? 'order-cancel-button' : 'admin-primary'} onClick={() => void changeStatus(activeOrder, next)}>{updating ? 'Actualizando...' : next === 'CANCELLED' ? 'Cancelar pedido' : `Marcar: ${statusLabels[next]}`}</button>)}</div></div>}
          </section>}
          <p className="admin-footnote">Los pedidos pueden registrarse con retiro, entrega local o Envíopack. El pago todavía no está habilitado.</p>
        </section>
      </main>
    </div>
  )
}
