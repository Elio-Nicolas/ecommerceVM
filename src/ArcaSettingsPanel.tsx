import { useEffect, useState, type FormEvent } from 'react'

const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:7381').replace(/\/$/, '')

type ArcaSettings = {
  enabled: boolean
  environment: 'HOMOLOGATION'
  pointOfSale: number | null
  cuitConfigured: boolean
  certificateConfigured: boolean
  credentialsConfigured: boolean
}

type ArcaDiagnostics = {
  pointOfSale: number
  pointsOfSale: { number: number; emissionType: string; blocked: boolean; deactivationDate: string | null }[]
  selectedPointFound: boolean
  lastAuthorized: { pointOfSale: number; voucherType: number; lastVoucherNumber: number } | null
  voucherTypes: { id: number; description: string }[]
  ivaReceiverConditions: { id: number; description: string; voucherClass: string }[]
  queriedAt: string
}

const defaults: ArcaSettings = {
  enabled: false,
  environment: 'HOMOLOGATION',
  pointOfSale: null,
  cuitConfigured: false,
  certificateConfigured: false,
  credentialsConfigured: false,
}

export default function ArcaSettingsPanel({ token }: { token: string }) {
  const [settings, setSettings] = useState<ArcaSettings>(defaults)
  const [pointOfSale, setPointOfSale] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [diagnosing, setDiagnosing] = useState(false)
  const [diagnostics, setDiagnostics] = useState<ArcaDiagnostics | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  async function request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${API_URL}/api/v1${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...init?.headers },
    })
    const payload = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(payload?.error?.message || 'No se pudo completar la operación.')
    return payload as T
  }

  useEffect(() => {
    let active = true
    request<{ data: ArcaSettings }>('/admin/arca/settings')
      .then(({ data }) => {
        if (!active) return
        setSettings(data)
        setPointOfSale(data.pointOfSale === null ? '' : String(data.pointOfSale))
      })
      .catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : 'No se pudo cargar la configuración de ARCA.') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [token])

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (saving) return
    setSaving(true)
    setError('')
    setNotice('')
    setDiagnostics(null)
    const parsedPointOfSale = pointOfSale.trim() ? Number(pointOfSale) : null
    if (parsedPointOfSale !== null && (!Number.isInteger(parsedPointOfSale) || parsedPointOfSale < 1 || parsedPointOfSale > 99_998)) {
      setError('El punto de venta debe ser un entero entre 1 y 99998.')
      setSaving(false)
      return
    }
    try {
      const result = await request<{ data: ArcaSettings; message: string }>('/admin/arca/settings', {
        method: 'PUT',
        body: JSON.stringify({
          enabled: settings.enabled && parsedPointOfSale !== null && settings.credentialsConfigured,
          environment: 'HOMOLOGATION',
          pointOfSale: parsedPointOfSale,
        }),
      })
      setSettings(result.data)
      setNotice(result.message)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo guardar la configuración de ARCA.')
    } finally {
      setSaving(false)
    }
  }

  async function testConnection() {
    if (testing) return
    setTesting(true)
    setError('')
    setNotice('')
    try {
      const result = await request<{ message: string }>('/admin/arca/settings/test', { method: 'POST', body: '{}' })
      setNotice(result.message)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo verificar la conexión con ARCA.')
    } finally {
      setTesting(false)
    }
  }

  async function loadDiagnostics() {
    if (diagnosing) return
    setDiagnosing(true)
    setError('')
    setNotice('')
    setDiagnostics(null)
    try {
      const result = await request<{ data: ArcaDiagnostics; message: string }>('/admin/arca/diagnostics')
      setDiagnostics(result.data)
      setNotice(result.message)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudieron consultar los datos de ARCA.')
    } finally {
      setDiagnosing(false)
    }
  }

  if (loading) return <section className="admin-category-card"><div className="admin-table-empty">Cargando configuración de ARCA...</div></section>

  const selectedPoint = diagnostics?.pointsOfSale.find((point) => point.number === diagnostics.pointOfSale)

  return (
    <section className="admin-category-card arca-settings-card">
      <div className="admin-category-heading">
        <h2>Facturación electrónica · ARCA</h2>
        <p>Configuración inicial de homologación. La emisión de comprobantes todavía no está habilitada.</p>
      </div>
      {error && <div className="admin-alert error">{error}</div>}
      {notice && <div className="admin-alert success">{notice}</div>}
      <form className="shipping-settings-form" onSubmit={(event) => void save(event)}>
        <section className="shipping-setting-section">
          <div className="shipping-setting-title">
            <div>
              <span className="admin-kicker">ENTORNO DE PRUEBAS</span>
              <h3>ARCA · Homologación</h3>
              <p>Se utilizará el entorno de homologación. Producción permanece bloqueada hasta completar y validar las pruebas.</p>
            </div>
            <label className="admin-checkbox">
              <input
                type="checkbox"
                checked={settings.enabled}
                disabled={!settings.credentialsConfigured || !settings.pointOfSale}
                onChange={(event) => setSettings((current) => ({ ...current, enabled: event.target.checked }))}
              />
              Habilitar integración
            </label>
          </div>
          <div className="admin-form-grid">
            <label>Entorno<input value="Homologación" readOnly /></label>
            <label>Punto de venta ARCA<input type="number" min="1" max="99998" step="1" value={pointOfSale} onChange={(event) => setPointOfSale(event.target.value)} placeholder="Ej. 1" /></label>
          </div>
          <div className="arca-credential-list">
            <div><span className={settings.cuitConfigured ? 'shipping-status-dot is-ready' : 'shipping-status-dot'} />CUIT configurado en API <strong>{settings.cuitConfigured ? 'Sí' : 'Pendiente'}</strong></div>
            <div><span className={settings.certificateConfigured ? 'shipping-status-dot is-ready' : 'shipping-status-dot'} />Certificado y clave privada instalados <strong>{settings.certificateConfigured ? 'Sí' : 'Pendiente'}</strong></div>
          </div>
          {!settings.credentialsConfigured && <p className="shipping-settings-help">Las rutas del certificado y la clave privada se configuran como variables de entorno en la API. Los archivos deben permanecer fuera del repositorio. No pegues certificados ni claves en este formulario.</p>}
          <div className="admin-category-actions">
            <button type="button" className="admin-quiet-button" onClick={() => void testConnection()} disabled={testing || !settings.credentialsConfigured || !settings.pointOfSale}>
              {testing ? 'Probando conexión...' : 'Probar conexión con ARCA'}
            </button>
            <button type="button" className="admin-primary" onClick={() => void loadDiagnostics()} disabled={diagnosing || !settings.credentialsConfigured || !settings.pointOfSale}>
              {diagnosing ? 'Consultando ARCA...' : 'Consultar datos de homologación'}
            </button>
          </div>
        </section>
        <div className="admin-category-actions shipping-settings-actions">
          <button className="admin-primary" disabled={saving}>{saving ? 'Guardando...' : 'Guardar configuración de ARCA'}</button>
        </div>
      </form>

      {diagnostics && (
        <section className="arca-diagnostics">
          <div className="arca-diagnostics-heading">
            <div><span className="admin-kicker">LECTURA WSFEV1</span><h3>Datos recibidos de ARCA</h3></div>
            <small>Consultado {new Date(diagnostics.queriedAt).toLocaleString('es-AR')}</small>
          </div>
          <div className="arca-diagnostics-summary">
            <div><span>PUNTO DE VENTA CONFIGURADO</span><strong>{diagnostics.pointOfSale}</strong></div>
            <div><span>ESTADO DEL PUNTO</span><strong>{!diagnostics.selectedPointFound ? 'No encontrado' : selectedPoint?.blocked ? 'Bloqueado' : 'Habilitado'}</strong></div>
            <div><span>ÚLTIMA FACTURA C AUTORIZADA</span><strong>{diagnostics.lastAuthorized ? diagnostics.lastAuthorized.lastVoucherNumber : 'Sin dato'}</strong></div>
          </div>
          {!diagnostics.selectedPointFound && <div className="admin-alert error">El punto de venta configurado no aparece en la respuesta de ARCA.</div>}
          {selectedPoint && <p className="shipping-settings-help">Tipo de emisión: {selectedPoint.emissionType || 'No informado'}{selectedPoint.deactivationDate ? ` · Fecha de baja: ${selectedPoint.deactivationDate}` : ''}</p>}
          <div className="arca-diagnostics-grid">
            <div><h4>Puntos de venta ({diagnostics.pointsOfSale.length})</h4><div className="arca-diagnostics-list">{diagnostics.pointsOfSale.map((point) => <div key={point.number}><strong>{point.number}</strong><span>{point.emissionType || 'Emisión no informada'}</span><small>{point.blocked ? 'Bloqueado' : point.deactivationDate ? `Baja ${point.deactivationDate}` : 'Activo'}</small></div>)}</div></div>
            <div><h4>Tipos de comprobante ({diagnostics.voucherTypes.length})</h4><div className="arca-diagnostics-list">{diagnostics.voucherTypes.map((item) => <div key={item.id}><strong>{item.id}</strong><span>{item.description}</span></div>)}</div></div>
            <div><h4>Condiciones IVA receptor ({diagnostics.ivaReceiverConditions.length})</h4><div className="arca-diagnostics-list">{diagnostics.ivaReceiverConditions.map((item) => <div key={item.id}><strong>{item.id}</strong><span>{item.description}</span></div>)}</div></div>
          </div>
        </section>
      )}
    </section>
  )
}
