import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { formatPrice } from './products'
import './sales-report.css'

const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:7381').replace(/\/$/, '')
const TOKEN_KEY = 'ecommercevm_admin_token'

type PaymentMethod = 'CASH' | 'MERCADO_PAGO' | 'GOCUOTAS'
type Transaction = {
  id: string
  orderId: string
  orderCode: string
  customerName: string
  customerPhone: string
  paymentMethod: PaymentMethod
  amountArs: number
  paidAt: string
  orderStatus: string
  deliveryMethod: string
  refundStatus: 'NONE' | 'PARTIAL' | 'FULL'
  refundAmountArs: number
  providerReference: string | null
  paymentStatus: string
  items: Array<{ productName: string; quantity: number; lineTotalArs: number }>
}
type MethodSummary = {
  paymentMethod: PaymentMethod
  label: string
  transactions: number
  orders: number
  grossCollectedArs: number
  fullyRefundedArs: number
  netAfterFullRefundsArs: number
  partialRefunds: number
}
type PendingPayment = {
  orderId: string
  orderCode: string
  customerName: string
  customerPhone: string
  paymentMethod: string
  amountArs: number
  orderStatus: string
  paymentStatus: string
  statusDetail: string | null
  lastError: string | null
  createdAt: string
  lastAttemptAt: string | null
}
type Report = {
  pendingPayments: PendingPayment[]
  period: { from: string; to: string; days: number }
  summary: {
    grossCollectedArs: number
    fullyRefundedArs: number
    netAfterFullRefundsArs: number
    transactions: number
    orders: number
    partialRefunds: number
    averageTicketArs: number
  }
  byPaymentMethod: MethodSummary[]
  byDay: Array<{ date: string; CASH: number; MERCADO_PAGO: number; GOCUOTAS: number; totalArs: number }>
  transactions: Transaction[]
}

async function request<T>(path: string, token: string): Promise<T> {
  const response = await fetch(`${API_URL}/api/v1${path}`, { headers: { Authorization: `Bearer ${token}` } })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload?.error?.message || 'No se pudo cargar el informe.')
  return payload as T
}

function todayInArgentina() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date())
}
function shiftDate(value: string, days: number) {
  const date = new Date(`${value}T12:00:00-03:00`)
  date.setUTCDate(date.getUTCDate() + days)
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(date)
}
function formatDate(value: string, includeTime = false) {
  return new Intl.DateTimeFormat('es-AR', {
    timeZone: 'America/Argentina/Buenos_Aires',
    day: '2-digit', month: '2-digit', year: 'numeric',
    ...(includeTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  }).format(new Date(value))
}
const methodLabels: Record<PaymentMethod, string> = {
  CASH: 'Efectivo / a coordinar',
  MERCADO_PAGO: 'Mercado Pago',
  GOCUOTAS: 'GOcuotas',
}
const orderStatusLabels: Record<string, string> = {
  PENDING: 'Pendiente', CONFIRMED: 'Confirmado', PREPARING: 'En preparación',
  SHIPPED: 'Despachado', DELIVERED: 'Entregado', CANCELLED: 'Cancelado',
}
const refundLabels = { NONE: 'Sin reintegro', PARTIAL: 'Reintegro parcial', FULL: 'Reintegro total' }

function csvCell(value: unknown) {
  let text = String(value ?? '')
  if (/^[=+@-]/.test(text)) text = `'${text}`
  return `"${text.replace(/"/g, '""')}"`
}

export default function AdminSales() {
  const [token] = useState(() => localStorage.getItem(TOKEN_KEY) || '')
  const [checking, setChecking] = useState(true)
  const [from, setFrom] = useState(todayInArgentina)
  const [to, setTo] = useState(todayInArgentina)
  const [appliedFrom, setAppliedFrom] = useState(todayInArgentina)
  const [appliedTo, setAppliedTo] = useState(todayInArgentina)
  const [report, setReport] = useState<Report | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [method, setMethod] = useState('ALL')
  const [search, setSearch] = useState('')

  const loadReport = useCallback(async (authToken: string) => {
    setLoading(true)
    setError('')
    try {
      const params = new URLSearchParams({ from: appliedFrom, to: appliedTo })
      const result = await request<{ data: Report }>(`/admin/sales?${params.toString()}`, authToken)
      setReport(result.data)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo cargar el informe.')
      setReport(null)
    } finally {
      setLoading(false)
    }
  }, [appliedFrom, appliedTo])

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
    if (!checking && token) void loadReport(token)
  }, [checking, token, loadReport])

  const visibleTransactions = useMemo(() => {
    const term = search.trim().toLocaleLowerCase('es')
    return (report?.transactions || []).filter((item) =>
      (method === 'ALL' || item.paymentMethod === method)
      && (!term || `${item.orderCode} ${item.customerName} ${item.customerPhone} ${item.items.map((line) => line.productName).join(' ')}`.toLocaleLowerCase('es').includes(term)),
    )
  }, [report, method, search])

  function applyPeriod(event?: FormEvent) {
    event?.preventDefault()
    setAppliedFrom(from)
    setAppliedTo(to)
  }
  function setPreset(days: number) {
    const end = todayInArgentina()
    const start = shiftDate(end, -(days - 1))
    setFrom(start); setTo(end); setAppliedFrom(start); setAppliedTo(end)
  }
  function exportCsv() {
    if (!visibleTransactions.length) return
    const headers = ['Fecha y hora de cobro', 'Pedido', 'Cliente', 'Teléfono', 'Medio de pago', 'Importe cobrado', 'Reintegro', 'Estado de reintegro', 'Estado del pedido', 'Entrega', 'Referencia', 'Artículos']
    const rows = visibleTransactions.map((item) => [
      formatDate(item.paidAt, true), item.orderCode, item.customerName, item.customerPhone,
      methodLabels[item.paymentMethod], item.amountArs, item.refundAmountArs, refundLabels[item.refundStatus],
      orderStatusLabels[item.orderStatus] || item.orderStatus, item.deliveryMethod, item.providerReference || '',
      item.items.map((line) => `${line.quantity} x ${line.productName}`).join(' | '),
    ])
    const csv = '\uFEFF' + [headers, ...rows].map((row) => row.map(csvCell).join(';')).join('\r\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `ventas-${appliedFrom}-${appliedTo}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  if (checking) return <div className="admin-loading">Verificando sesión...</div>

  return (
    <div className="admin-layout">
      <aside className="admin-sidebar">
        <a className="admin-brand" href="/"><svg className="admin-brand-mark" viewBox="0 0 40 48" role="img" aria-label="VM, Villa Mercedes"><path d="M20 2.5C10.2 2.5 2.5 10.2 2.5 20c0 12.2 17.5 25.3 17.5 25.3S37.5 32.2 37.5 20C37.5 10.2 29.8 2.5 20 2.5Z" fill="#E04B2F" /><circle cx="20" cy="19.5" r="11.5" fill="#fff" /><text x="20" y="23.2" textAnchor="middle" fill="#E04B2F" fontFamily="Manrope, sans-serif" fontSize="9.5" fontWeight="800" letterSpacing="-.4">VM</text></svg><span>Tu Tienda<span>VM</span></span></a>
        <div className="admin-nav-label">GESTIÓN</div>
        <a className="admin-nav-item" href="/admin"><span className="admin-nav-icon">▦</span> Productos</a>
        <a className="admin-nav-item" href="/admin/pedidos"><span className="admin-nav-icon">▤</span> Pedidos</a>
        <a className="admin-nav-item active" href="/admin/ventas"><span className="admin-nav-icon">▥</span> Ventas</a>
        <div className="admin-sidebar-bottom"><span className="admin-avatar">A</span><div><strong>Sesión administrativa</strong><small>Administrador</small></div><button onClick={() => { localStorage.removeItem(TOKEN_KEY); window.location.replace('/admin') }} title="Cerrar sesión">↗</button></div>
      </aside>

      <main className="admin-main">
        <header className="admin-topbar"><div><span>TU TIENDAVM / ADMINISTRACIÓN</span><h1>Ventas</h1></div><a href="/" className="admin-store-link">Ver tienda ↗</a></header>
        <section className="admin-content sales-content">
          <div className="admin-page-heading"><div><h2>Informe de ventas</h2><p>Seguimiento de cobros, medios de pago y operaciones del negocio.</p></div><button type="button" className="admin-quiet-button" onClick={() => { if (token) void loadReport(token) }} disabled={loading}>↻ Actualizar</button></div>

          <form className="sales-filter-card" onSubmit={applyPeriod}>
            <div className="sales-period-presets">
              <button type="button" onClick={() => setPreset(1)} className={appliedFrom === todayInArgentina() && appliedTo === todayInArgentina() ? 'selected' : ''}>Hoy</button>
              <button type="button" onClick={() => { const yesterday = shiftDate(todayInArgentina(), -1); setFrom(yesterday); setTo(yesterday); setAppliedFrom(yesterday); setAppliedTo(yesterday) }}>Ayer</button>
              <button type="button" onClick={() => setPreset(7)}>Últimos 7 días</button>
              <button type="button" onClick={() => setPreset(30)}>Últimos 30 días</button>
            </div>
            <div className="sales-date-fields">
              <label>Desde<input type="date" value={from} max={to} onChange={(event) => setFrom(event.target.value)} required /></label>
              <label>Hasta<input type="date" value={to} min={from} onChange={(event) => setTo(event.target.value)} required /></label>
              <button className="admin-primary" disabled={loading}>{loading ? 'Consultando...' : 'Aplicar período'}</button>
            </div>
            <small>Los cobros se agrupan por fecha efectiva de aprobación o registro, no por la fecha en que se creó el pedido.</small>
          </form>

          {error && <div className="admin-alert error">{error}</div>}
          {loading && !report ? <div className="admin-table-empty">Consultando operaciones...</div> : report && <>
            <div className="sales-report-meta"><span>PERÍODO ANALIZADO</span><strong>{formatDate(`${report.period.from}T12:00:00-03:00`)} {report.period.from !== report.period.to ? `— ${formatDate(`${report.period.to}T12:00:00-03:00`)}` : ''}</strong><small>{report.period.days} día(s) · importes en pesos argentinos</small></div>

            <section className="sales-section-card sales-pending-card">
              <div className="sales-section-heading"><div><h2>Pagos pendientes de resolución</h2><p>Pedidos sin cobro confirmado. Revisalos y actuá desde el pedido; no se suman a las ventas cobradas.</p></div><span className="sales-pending-count">{report.pendingPayments.length} pendientes</span></div>
              {report.pendingPayments.length === 0 ? <div className="sales-pending-empty">No hay pedidos pendientes de cobro.</div> : <div className="sales-pending-list">
                {report.pendingPayments.map((item) => {
                  const paymentLabel = item.paymentMethod === 'MERCADO_PAGO' ? 'Mercado Pago' : item.paymentMethod === 'GOCUOTAS' ? 'GOcuotas' : item.paymentMethod === 'CASH' ? 'Efectivo / a coordinar' : item.paymentMethod
                  const statusLabel: Record<string, string> = { CREATING: 'Iniciando pago', PENDING: 'Esperando confirmación', UNKNOWN: 'Estado incierto · verificar', REJECTED: 'Pago rechazado', CANCELLED: 'Intento cancelado', WAITING_FOR_PAYMENT: 'Sin pago iniciado' }
                  return <article className="sales-pending-row" key={item.orderId}>
                    <div className="sales-pending-main"><div><strong>{item.orderCode}</strong><span>{item.customerName} · {item.customerPhone}</span></div><span className="sales-pending-status">{statusLabel[item.paymentStatus] || item.paymentStatus}</span></div>
                    <div className="sales-pending-meta"><span>{paymentLabel}</span><strong>{formatPrice(item.amountArs)}</strong><small>Pedido {formatDate(item.createdAt, true)} · {orderStatusLabels[item.orderStatus] || item.orderStatus}</small>{item.statusDetail && <small>Detalle: {item.statusDetail}</small>}{item.lastError && <small className="sales-pending-error">Último error: {item.lastError}</small>}</div>
                    <a className="sales-pending-action" href={`/admin/pedidos?q=${encodeURIComponent(item.orderCode)}`}>Revisar pedido ↗</a>
                  </article>
                })}
              </div>}
            </section>

            <div className="sales-kpis">
              <article><span>COBRADO BRUTO</span><strong>{formatPrice(report.summary.grossCollectedArs)}</strong><small>{report.summary.transactions} operaciones cobradas</small></article>
              <article><span>REINTEGROS TOTALES</span><strong>{formatPrice(report.summary.fullyRefundedArs)}</strong><small>Operaciones reintegradas por completo</small></article>
              <article><span>NETO TRAS REINTEGROS TOTALES</span><strong>{formatPrice(report.summary.netAfterFullRefundsArs)}</strong><small>No descuenta reintegros parciales</small></article>
              <article><span>PEDIDOS CON COBRO</span><strong>{report.summary.orders}</strong><small>Ticket promedio {formatPrice(report.summary.averageTicketArs)}</small></article>
            </div>

            {report.summary.partialRefunds > 0 && <div className="sales-partial-warning">Hay {report.summary.partialRefunds} operación(es) con reintegro parcial. El importe parcial no está disponible en el registro actual del proveedor y no se descuenta del neto mostrado.</div>}

            <section className="sales-section-card">
              <div className="sales-section-heading"><div><h2>Rendimiento por medio de pago</h2><p>Comparación de cobros y reintegros dentro del período.</p></div></div>
              <div className="admin-table-scroll"><table className="admin-table sales-method-table"><thead><tr><th>MEDIO DE PAGO</th><th>OPERACIONES</th><th>PEDIDOS</th><th>COBRADO</th><th>REINTEGRADO</th><th>NETO*</th></tr></thead><tbody>
                {report.byPaymentMethod.map((item) => <tr key={item.paymentMethod}><td><strong>{item.label}</strong></td><td>{item.transactions}</td><td>{item.orders}</td><td className="admin-price">{formatPrice(item.grossCollectedArs)}</td><td>{formatPrice(item.fullyRefundedArs)}{item.partialRefunds > 0 ? <small className="sales-partial-count"> + {item.partialRefunds} parcial(es)</small> : null}</td><td className="admin-price">{formatPrice(item.netAfterFullRefundsArs)}</td></tr>)}
              </tbody></table></div>
              <div className="sales-table-note">* Neto luego de reintegros totales confirmados. Los parciales se identifican por separado.</div>
            </section>

            <section className="sales-section-card">
              <div className="sales-section-heading"><div><h2>Ventas por día</h2><p>Distribución diaria de los cobros por medio de pago.</p></div></div>
              {report.byDay.length === 0 ? <div className="admin-table-empty">No hay cobros registrados en este período.</div> : <div className="sales-daily-chart">
                {report.byDay.map((day) => {
                  const total = Math.max(day.totalArs, 1)
                  return <div className="sales-daily-row" key={day.date}>
                    <time>{formatDate(`${day.date}T12:00:00-03:00`)}</time>
                    <div className="sales-bar-track"><span className="sales-bar-mp" style={{ width: `${day.MERCADO_PAGO / total * 100}%` }} /><span className="sales-bar-gc" style={{ width: `${day.GOCUOTAS / total * 100}%` }} /><span className="sales-bar-cash" style={{ width: `${day.CASH / total * 100}%` }} /></div>
                    <strong>{formatPrice(day.totalArs)}</strong>
                  </div>
                })}
                <div className="sales-chart-legend"><span><i className="sales-bar-mp" /> Mercado Pago</span><span><i className="sales-bar-gc" /> GOcuotas</span><span><i className="sales-bar-cash" /> Efectivo / a coordinar</span></div>
              </div>}
              {report.byDay.length > 0 && <div className="admin-table-scroll"><table className="admin-table sales-daily-table"><thead><tr><th>DÍA</th><th>MERCADO PAGO</th><th>GOCUOTAS</th><th>EFECTIVO / A COORDINAR</th><th>TOTAL</th></tr></thead><tbody>
                {report.byDay.map((day) => <tr key={day.date}><td>{formatDate(`${day.date}T12:00:00-03:00`)}</td><td>{formatPrice(day.MERCADO_PAGO)}</td><td>{formatPrice(day.GOCUOTAS)}</td><td>{formatPrice(day.CASH)}</td><td className="admin-price">{formatPrice(day.totalArs)}</td></tr>)}
              </tbody></table></div>}
            </section>

            <section className="sales-section-card">
              <div className="sales-section-heading sales-transactions-heading"><div><h2>Detalle de operaciones</h2><p>Accedé al pedido, cliente, medio de pago y situación del reintegro.</p></div><button type="button" className="admin-quiet-button" onClick={exportCsv} disabled={!visibleTransactions.length}>↓ Exportar CSV</button></div>
              <div className="admin-table-toolbar sales-toolbar">
                <label className="admin-search">⌕<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar pedido, cliente, teléfono o producto..." /></label>
                <select value={method} onChange={(event) => setMethod(event.target.value)} aria-label="Filtrar medio de pago"><option value="ALL">Todos los medios</option><option value="MERCADO_PAGO">Mercado Pago</option><option value="GOCUOTAS">GOcuotas</option><option value="CASH">Efectivo / a coordinar</option></select>
              </div>
              {visibleTransactions.length === 0 ? <div className="admin-table-empty">No hay operaciones que coincidan con los filtros.</div> : <div className="admin-table-scroll"><table className="admin-table sales-detail-table"><thead><tr><th>FECHA DE COBRO</th><th>PEDIDO / CLIENTE</th><th>MEDIO</th><th>ARTÍCULOS</th><th>IMPORTE</th><th>REINTEGRO</th><th>ESTADO PEDIDO</th></tr></thead><tbody>
                {visibleTransactions.map((item) => <tr key={item.id}>
                  <td>{formatDate(item.paidAt, true)}</td>
                  <td><strong>{item.orderCode}</strong><small>{item.customerName} · {item.customerPhone}</small><button type="button" className="sales-open-order" onClick={() => window.location.assign(`/admin/pedidos?q=${encodeURIComponent(item.orderCode)}`)}>Ver pedido</button></td>
                  <td>{methodLabels[item.paymentMethod]}<small>{item.providerReference ? `Ref. ${item.providerReference}` : item.paymentStatus === 'RECEIVED' ? 'Cobro registrado por administración' : item.paymentStatus}</small></td>
                  <td><div className="sales-item-list">{item.items.map((line, index) => <span key={`${item.id}-${index}`}>{line.quantity} × {line.productName}</span>)}</div></td>
                  <td className="admin-price">{formatPrice(item.amountArs)}</td>
                  <td><span className={`sales-refund-status ${item.refundStatus.toLowerCase()}`}>{refundLabels[item.refundStatus]}</span>{item.refundAmountArs > 0 && <small>{formatPrice(item.refundAmountArs)}</small>}</td>
                  <td><span className={`admin-status order-status ${item.orderStatus.toLowerCase()}`}>{orderStatusLabels[item.orderStatus] || item.orderStatus}</span></td>
                </tr>)}
              </tbody></table></div>}
              <div className="admin-table-footer">Mostrando {visibleTransactions.length} de {report.transactions.length} operaciones del período.</div>
            </section>
          </>}
        </section>
      </main>
    </div>
  )
}
