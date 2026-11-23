import { useCallback, useEffect, useMemo, useState } from 'react'
import { formatPrice } from './products'
import './sales-report.css'

const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:7381').replace(/\/$/, '')
const TOKEN_KEY = 'ecommercevm_admin_token'
type ProductProfit = { productName: string; productSku: string; quantity: number; revenueArs: number; costArs: number | null }
type ProfitOrder = { orderId: string; orderCode: string; paidAt: string; productRevenueArs: number; shippingChargedArs: number; productCostArs: number; logisticsCostArs: number | null; estimatedMarginArs: number | null; hasPartialRefund: boolean }
type ProfitReport = {
  period: { from: string; to: string; days: number }
  summary: { paidOrders: number; activePaidOrders: number; fullyRefundedOrders: number; fullyRefundedArs: number; productRevenueArs: number; shippingChargedArs: number; netRevenueArs: number; knownProductCostArs: number; completeOrders: number; incompleteOrders: number; partialRefundOrders: number; productCostArs: number; logisticsCostArs: number; estimatedGrossMarginArs: number; marginCoveragePercent: number }
  products: ProductProfit[]
  orders: ProfitOrder[]
}
async function request<T>(path: string, token: string): Promise<T> {
  const response = await fetch(`${API_URL}/api/v1${path}`, { headers: { Authorization: `Bearer ${token}` } })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload?.error?.message || 'No se pudo cargar rentabilidad.')
  return payload as T
}
function today() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date()) }
function shift(value: string, days: number) { const date = new Date(`${value}T12:00:00-03:00`); date.setUTCDate(date.getUTCDate() + days); return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(date) }
function dateLabel(value: string) { return new Intl.DateTimeFormat('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(value)) }
function dateTime(value: string) { return new Intl.DateTimeFormat('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)) }

export default function AdminProfitability() {
  const [token] = useState(() => localStorage.getItem(TOKEN_KEY) || '')
  const [checking, setChecking] = useState(true)
  const [from, setFrom] = useState(today)
  const [to, setTo] = useState(today)
  const [appliedFrom, setAppliedFrom] = useState(today)
  const [appliedTo, setAppliedTo] = useState(today)
  const [report, setReport] = useState<ProfitReport | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const load = useCallback(async () => {
    if (!token) return
    setLoading(true); setError('')
    try {
      const params = new URLSearchParams({ from: appliedFrom, to: appliedTo })
      const result = await request<{ data: ProfitReport }>(`/admin/profitability?${params}`, token)
      setReport(result.data)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo cargar rentabilidad.'); setReport(null) }
    finally { setLoading(false) }
  }, [token, appliedFrom, appliedTo])
  useEffect(() => {
    if (!token) { window.location.replace('/admin'); return }
    request('/auth/me', token).then(() => setChecking(false)).catch(() => { localStorage.removeItem(TOKEN_KEY); window.location.replace('/admin') })
  }, [token])
  useEffect(() => { if (!checking) void load() }, [checking, load])
  const products = useMemo(() => (report?.products || []).filter((item) => !search.trim() || `${item.productName} ${item.productSku}`.toLocaleLowerCase('es').includes(search.trim().toLocaleLowerCase('es'))), [report, search])
  function preset(days: number) { const end = today(); const start = shift(end, -(days - 1)); setFrom(start); setTo(end); setAppliedFrom(start); setAppliedTo(end) }
  if (checking) return <div className="admin-loading">Verificando sesión...</div>
  const s = report?.summary
  return <div className="admin-layout">
    <aside className="admin-sidebar">
      <a className="admin-brand" href="/"><svg className="admin-brand-mark" viewBox="0 0 40 48" role="img" aria-label="VM, Villa Mercedes"><path d="M20 2.5C10.2 2.5 2.5 10.2 2.5 20c0 12.2 17.5 25.3 17.5 25.3S37.5 32.2 37.5 20C37.5 10.2 29.8 2.5 20 2.5Z" fill="#E04B2F"/><circle cx="20" cy="19.5" r="11.5" fill="#fff"/><text x="20" y="23.2" textAnchor="middle" fill="#E04B2F" fontFamily="Manrope, sans-serif" fontSize="9.5" fontWeight="800">VM</text></svg><span>Tu Tienda<span>VM</span></span></a>
      <div className="admin-nav-label">GESTIÓN</div>
      <a className="admin-nav-item" href="/admin">▦ Productos</a><a className="admin-nav-item" href="/admin/pedidos">▤ Pedidos</a><a className="admin-nav-item" href="/admin/ventas">▥ Ventas</a><a className="admin-nav-item active" href="/admin/rentabilidad">▧ Rentabilidad</a>
      <div className="admin-sidebar-bottom"><span className="admin-avatar">A</span><div><strong>Sesión administrativa</strong><small>Administrador</small></div><button onClick={() => { localStorage.removeItem(TOKEN_KEY); window.location.replace('/admin') }} title="Cerrar sesión">↗</button></div>
    </aside>
    <main className="admin-main">
      <header className="admin-topbar"><div><span>TU TIENDAVM / ADMINISTRACIÓN</span><h1>Rentabilidad</h1></div><a href="/" className="admin-store-link">Ver tienda ↗</a></header>
      <section className="admin-content sales-content">
        <div className="admin-page-heading"><div><h2>Rentabilidad del negocio</h2><p>Margen estimado a partir de costos de compra y logística registrados.</p></div><button type="button" className="admin-quiet-button" onClick={() => void load()} disabled={loading}>↻ Actualizar</button></div>
        <form className="sales-filter-card" onSubmit={(event) => { event.preventDefault(); setAppliedFrom(from); setAppliedTo(to) }}>
          <div className="sales-period-presets"><button type="button" onClick={() => preset(1)}>Hoy</button><button type="button" onClick={() => { const y=shift(today(),-1); setFrom(y); setTo(y); setAppliedFrom(y); setAppliedTo(y) }}>Ayer</button><button type="button" onClick={() => preset(7)}>Últimos 7 días</button><button type="button" onClick={() => preset(30)}>Últimos 30 días</button></div>
          <div className="sales-date-fields"><label>Desde<input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} required /></label><label>Hasta<input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} required /></label><button className="admin-primary" disabled={loading}>Aplicar período</button></div>
        </form>
        {error && <div className="admin-alert error">{error}</div>}
        {loading && !report ? <div className="admin-table-empty">Calculando...</div> : s && report && <>
          <div className="sales-report-meta"><span>PERÍODO ANALIZADO</span><strong>{dateLabel(`${report.period.from}T12:00:00-03:00`)} — {dateLabel(`${report.period.to}T12:00:00-03:00`)}</strong><small>{report.period.days} día(s)</small></div>
          <div className="sales-kpis">
            <article><span>INGRESOS NETOS REGISTRADOS</span><strong>{formatPrice(s.netRevenueArs)}</strong><small>Productos + envío cobrado, excluye pedidos totalmente reintegrados</small></article>
            <article><span>COSTO DE MERCADERÍA</span><strong>{formatPrice(s.productCostArs)}</strong><small>Solo pedidos con costos completos</small></article>
            <article><span>COSTO LOGÍSTICO</span><strong>{formatPrice(s.logisticsCostArs)}</strong><small>Solo pedidos con costos completos</small></article>
            <article><span>MARGEN BRUTO ESTIMADO</span><strong>{formatPrice(s.estimatedGrossMarginArs)}</strong><small>{s.completeOrders} de {s.activePaidOrders} pedidos con costos completos</small></article>
          </div>
          <div className="sales-coverage"><div><strong>Cobertura de costos: {s.marginCoveragePercent}%</strong><span>{s.incompleteOrders} pedido(s) sin datos suficientes para calcular margen. No se estiman costos faltantes.</span></div><div className="sales-coverage-track"><i style={{ width: `${s.marginCoveragePercent}%` }} /></div></div>
          {(s.fullyRefundedOrders > 0 || s.partialRefundOrders > 0) && <div className="sales-partial-warning">Reintegros totales: {s.fullyRefundedOrders} ({formatPrice(s.fullyRefundedArs)}). Reintegros parciales: {s.partialRefundOrders}; no se dispone de un importe parcial confiable para ajustar el margen.</div>}
          <section className="sales-section-card"><div className="sales-section-heading"><div><h2>Rentabilidad por producto</h2><p>Costos históricos tomados de cada pedido; los productos sin costo quedan identificados.</p></div></div>
            <div className="admin-table-toolbar sales-toolbar"><label className="admin-search">⌕<input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar producto o SKU..." /></label></div>
            <div className="admin-table-scroll"><table className="admin-table sales-method-table"><thead><tr><th>PRODUCTO</th><th>UNIDADES</th><th>VENTA</th><th>COSTO</th><th>MARGEN BRUTO</th></tr></thead><tbody>{products.map((p) => <tr key={p.productSku}><td><strong>{p.productName}</strong><small>{p.productSku}</small></td><td>{p.quantity}</td><td>{formatPrice(p.revenueArs)}</td><td>{p.costArs === null ? <span className="sales-cost-missing">Falta cargar</span> : formatPrice(p.costArs)}</td><td>{p.costArs === null ? '—' : formatPrice(p.revenueArs-p.costArs)}</td></tr>)}</tbody></table></div>
          </section>
          <section className="sales-section-card"><div className="sales-section-heading"><div><h2>Detalle por pedido</h2><p>El margen se muestra únicamente cuando el costo de cada artículo y el de entrega están informados.</p></div></div>
            <div className="admin-table-scroll"><table className="admin-table sales-method-table"><thead><tr><th>FECHA DE COBRO</th><th>PEDIDO</th><th>VENTA PRODUCTOS</th><th>ENVÍO COBRADO</th><th>COSTOS</th><th>MARGEN ESTIMADO</th></tr></thead><tbody>{report.orders.map((o) => <tr key={o.orderId}><td>{dateTime(o.paidAt)}</td><td><a href={`/admin/pedidos?q=${encodeURIComponent(o.orderCode)}`}>{o.orderCode}</a></td><td>{formatPrice(o.productRevenueArs)}</td><td>{formatPrice(o.shippingChargedArs)}</td><td>{o.logisticsCostArs === null ? 'Incompletos' : formatPrice(o.productCostArs+o.logisticsCostArs)}</td><td>{o.estimatedMarginArs === null ? <span className="sales-cost-missing">Incompleto</span> : formatPrice(o.estimatedMarginArs)}</td></tr>)}</tbody></table></div>
          </section>
        </>}
      </section>
    </main>
  </div>
}
