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
          enabled: settings.enabled,
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

  if (loading) return <section className="admin-category-card"><div className="admin-table-empty">Cargando configuración de ARCA...</div></section>

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
            <button type="button" className="admin-quiet-button" onClick={() => void testConnection()} disabled={testing || !settings.credentialsConfigured}>
              {testing ? 'Probando conexión...' : 'Probar conexión con ARCA'}
            </button>
          </div>
        </section>
        <div className="admin-category-actions shipping-settings-actions">
          <button className="admin-primary" disabled={saving}>{saving ? 'Guardando...' : 'Guardar configuración de ARCA'}</button>
        </div>
      </form>
    </section>
  )
}
