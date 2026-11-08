import { useCallback, useEffect, useState } from 'react'
import { formatPrice } from './products'

const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:7381').replace(/\/$/, '')
const TOKEN_KEY = 'ecommercevm_admin_token'

type OrderStatus = 'PENDING' | 'CONFIRMED' | 'PREPARING' | 'SHIPPED' | 'DELIVERED' | 'CANCELLED'
type OrderItem = { id: string; productName: string; productSku: string; unitPriceArs: number; quantity: number; lineTotalArs: number }
type OrderHistory = { id: string; fromStatus: OrderStatus | null; toStatus: OrderStatus; note: string | null; createdAt: string; changedByAdmin?: { email: string } | null }
type Order = {
  id: string; code: string; status: OrderStatus; customerName: string; customerEmail: string | null
  customerPhone: string; addressLine: string; city: string; province: string; postalCode: string | null
  customerNotes: string | null; subtotalArs: number; shippingCostArs: number | null; totalArs: number | null
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
        <div className="admin-sidebar-bottom"><span className="admin-avatar">A</span><div><strong>Sesión administrativa</strong><small>Administrador</small></div><button onClick={() => { localStorage.removeItem(TOKEN_KEY); window.location.replace('/admin') }} title="Cerrar sesión">↗</button></div>
      </aside>

      <main className="admin-main">
        <header className="admin-topbar"><div><span>ECOMMERCEVM / ADMINISTRACIÓN</span><h1>Pedidos</h1></div><a href="/" className="admin-store-link">Ver tienda ↗</a></header>
        <section className="admin-content">
          <div className="admin-page-heading"><div><h2>Gestión de pedidos</h2><p>Consultá pedidos, revisá sus datos y actualizá el estado de preparación y entrega.</p></div></div>
          <div className="admin-stats order-stats">
            <div><span>PEDIDOS EN LISTADO</span><strong>{total}</strong></div>
            <div><span>PENDIENTES</span><strong>{orders.filter((item) => item.status === 'PENDING').length}</strong></div>
            <div><span>EN PREPARACIÓN</span><strong>{orders.filter((item) => item.status === 'PREPARING').length}</strong></div>
            <div><span>ENTREGADOS</span><strong>{orders.filter((item) => item.status === 'DELIVERED').length}</strong></div>
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
              <div><span>ENTREGA</span><strong>{activeOrder.addressLine}</strong><small>{[activeOrder.city, activeOrder.province, activeOrder.postalCode].filter(Boolean).join(' · ')}</small></div>
              <div><span>NOTAS</span><strong>{activeOrder.customerNotes || 'Sin indicaciones adicionales'}</strong></div>
            </div>
            <div className="order-items-list"><h3>Productos</h3>{activeOrder.items.map((item) => <div key={item.id}><span>{item.quantity} × {item.productName}<small>{item.productSku} · {formatPrice(item.unitPriceArs)} c/u</small></span><strong>{formatPrice(item.lineTotalArs)}</strong></div>)}</div>
            <div className="order-totals"><span>Subtotal</span><strong>{formatPrice(activeOrder.subtotalArs)}</strong><small>Envío: pendiente de cotización · Total final: pendiente</small></div>
            <div className="order-history"><h3>Historial de estados</h3>{activeOrder.history.map((entry) => <div key={entry.id}><span>{statusLabels[entry.toStatus]}<small>{entry.note || 'Sin observaciones'}{entry.changedByAdmin?.email ? ` · ${entry.changedByAdmin.email}` : ''}</small></span><time>{formatDate(entry.createdAt)}</time></div>)}</div>
            {nextStatuses[activeOrder.status].length > 0 && <div className="order-update-status"><label>Observación (opcional)<input value={note} onChange={(event) => setNote(event.target.value)} maxLength={500} placeholder="Ej. Cliente contactado, envío coordinado..." /></label><div>{nextStatuses[activeOrder.status].map((next) => <button key={next} disabled={updating} className={next === 'CANCELLED' ? 'order-cancel-button' : 'admin-primary'} onClick={() => void changeStatus(activeOrder, next)}>{updating ? 'Actualizando...' : next === 'CANCELLED' ? 'Cancelar pedido' : `Marcar: ${statusLabels[next]}`}</button>)}</div></div>}
          </section>}
          <p className="admin-footnote">Los pedidos se reciben sin cobrar. El costo de envío y el total final se confirman por separado; no hay pagos ni integración logística habilitados.</p>
        </section>
      </main>
    </div>
  )
}
