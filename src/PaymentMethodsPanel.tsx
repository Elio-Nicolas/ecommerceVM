import { useEffect, useState } from 'react'

const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:7381').replace(/\/$/, '')
type Settings = { cashEnabled: boolean; mercadoPagoEnabled: boolean; goCuotasEnabled: boolean; naranjaXEnabled: boolean }

const defaults: Settings = { cashEnabled: true, mercadoPagoEnabled: true, goCuotasEnabled: true, naranjaXEnabled: false }

export default function PaymentMethodsPanel({ token }: { token: string }) {
  const [settings, setSettings] = useState<Settings>(defaults)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
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
    request<{ data: Settings }>('/admin/payment-settings')
      .then(({ data }) => { if (active) setSettings(data) })
      .catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : 'No se pudo cargar la configuración.') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [token])

  async function toggle(key: keyof Settings, checked: boolean) {
    if (saving) return
    const next = { ...settings, [key]: checked }
    setSettings(next)
    setSaving(true)
    setError('')
    setNotice('')
    try {
      const result = await request<{ data: Settings }>('/admin/payment-settings', { method: 'PUT', body: JSON.stringify(next) })
      setSettings(result.data)
      setNotice('Configuración de medios de pago guardada.')
    } catch (cause) {
      setSettings(settings)
      setError(cause instanceof Error ? cause.message : 'No se pudo guardar la configuración.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="admin-category-card payment-methods-panel">
      <div className="admin-category-heading">
        <h2>Medios de pago</h2>
        <p>Activá o pausá cada proveedor para nuevas compras. Los pagos ya iniciados y sus notificaciones siguen procesándose.</p>
      </div>
      {loading ? <p>Cargando configuración...</p> : (
        <div className="admin-category-list">
          <label className="admin-category-row payment-method-toggle">
            <span><strong>Efectivo / transferencia coordinada</strong><small>Pago coordinado directamente con la tienda.</small></span>
            <input type="checkbox" checked={settings.cashEnabled} disabled={saving} onChange={(event) => void toggle("cashEnabled", event.target.checked)} />
          </label>
          <label className="admin-category-row payment-method-toggle">
            <span><strong>Mercado Pago</strong><small>Checkout y nuevos intentos de pago.</small></span>
            <input type="checkbox" checked={settings.mercadoPagoEnabled} disabled={saving} onChange={(event) => void toggle('mercadoPagoEnabled', event.target.checked)} />
          </label>
          <label className="admin-category-row payment-method-toggle">
            <span><strong>GOcuotas</strong><small>Checkout y nuevos intentos de pago.</small></span>
            <input type="checkbox" checked={settings.goCuotasEnabled} disabled={saving} onChange={(event) => void toggle('goCuotasEnabled', event.target.checked)} />
          </label>
          <label className="admin-category-row payment-method-toggle">
            <span><strong>Naranja X</strong><small>{settings.naranjaXEnabled ? 'Habilitado en configuración; requiere integración y credenciales operativas.' : 'Todavía no disponible para cobrar: integración y credenciales pendientes.'}</small></span>
            <input type="checkbox" checked={settings.naranjaXEnabled} disabled={true} title="Se habilitará cuando la integración oficial esté lista." />
          </label>
        </div>
      )}
      {saving && <p role="status">Guardando cambios...</p>}
      {notice && <div className="admin-alert success">{notice}</div>}
      {error && <div className="admin-alert error">{error}</div>}
    </section>
  )
}
