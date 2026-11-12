import { useEffect, useState, type FormEvent } from 'react'
const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:7381').replace(/\/$/, '')
type ShippingSettings = {
  ocaEnvironment: 'QA' | 'PRODUCTION'; ocaConfigured: boolean
  pickupEnabled: boolean; pickupAddress: string; pickupInstructions: string
  localDeliveryEnabled: boolean; localDeliveryPostalCodes: string[]
  localDeliveryFeeArs: number; localDeliveryInternalCostArs: number | null; localDeliveryCoordinate: boolean
}
const defaults: ShippingSettings = {
  ocaEnvironment: 'QA', ocaConfigured: false, pickupEnabled: true, pickupAddress: 'Domicilio del vendedor',
  pickupInstructions: 'La dirección exacta y el horario se coordinarán luego de confirmar el pedido.',
  localDeliveryEnabled: false, localDeliveryPostalCodes: ['5730'], localDeliveryFeeArs: 0,
  localDeliveryInternalCostArs: null, localDeliveryCoordinate: false,
}
export default function ShippingSettingsPanel({ token }: { token: string }) {
  const [settings, setSettings] = useState<ShippingSettings>(defaults)
  const [ocaUsername, setOcaUsername] = useState(''), [ocaPassword, setOcaPassword] = useState('')
  const [ocaCuit, setOcaCuit] = useState(''), [ocaOperative, setOcaOperative] = useState('')
  const [clearOcaCredentials, setClearOcaCredentials] = useState(false), [postalCodesText, setPostalCodesText] = useState('5730')
  const [loading, setLoading] = useState(true), [saving, setSaving] = useState(false)
  const [error, setError] = useState(''), [notice, setNotice] = useState('')
  async function request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${API_URL}/api/v1${path}`, { ...init, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...init?.headers } })
    const payload = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(payload?.error?.message || 'No se pudo completar la operación.')
    return payload as T
  }
  useEffect(() => {
    let active = true
    request<{ data: ShippingSettings }>('/admin/shipping-settings').then(({ data }) => {
      if (active) { setSettings(data); setPostalCodesText(data.localDeliveryPostalCodes.join(', ')) }
    }).catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : 'No se pudo cargar la configuración.') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [token])
  function update<K extends keyof ShippingSettings>(key: K, value: ShippingSettings[K]) { setSettings((current) => ({ ...current, [key]: value })) }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (saving) return
    setSaving(true); setError(''); setNotice('')
    const credentials = [ocaUsername.trim(), ocaPassword.trim(), ocaCuit.trim(), ocaOperative.trim()]
    if (credentials.some(Boolean) && !credentials.every(Boolean)) { setError('Para guardar OCA completá usuario, contraseña, CUIT y operativa.'); setSaving(false); return }
    if (clearOcaCredentials && credentials.some(Boolean)) { setError('No podés reemplazar y eliminar las credenciales OCA en la misma operación.'); setSaving(false); return }
    const payload = {
      ...settings, localDeliveryPostalCodes: [...new Set(postalCodesText.split(',').map((v) => v.trim()).filter(Boolean))],
      ...(credentials.every(Boolean) ? { ocaUsername: credentials[0], ocaPassword: credentials[1], ocaCuit: credentials[2].replace(/\D/g, ''), ocaOperative: credentials[3] } : {}),
      ...(clearOcaCredentials ? { clearOcaCredentials: true } : {}),
    }
    try {
      const result = await request<{ data: ShippingSettings }>('/admin/shipping-settings', { method: 'PUT', body: JSON.stringify(payload) })
      setSettings(result.data); setPostalCodesText(result.data.localDeliveryPostalCodes.join(', '))
      setOcaUsername(''); setOcaPassword(''); setOcaCuit(''); setOcaOperative(''); setClearOcaCredentials(false)
      setNotice('Configuración guardada. OCA queda pendiente de validar con los datos comerciales de tu cuenta.')
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo guardar la configuración.') }
    finally { setSaving(false) }
  }
  if (loading) return <section className="admin-category-card"><div className="admin-table-empty">Cargando configuración de envíos...</div></section>
  return <section className="admin-category-card shipping-settings-card">
    <div className="admin-category-heading"><h2>Configuración de envíos y entregas</h2><p>OCA es el proveedor nacional. Las credenciales se cifran en el backend.</p></div>
    {error && <div className="admin-alert error">{error}</div>}{notice && <div className="admin-alert success">{notice}</div>}
    <form className="shipping-settings-form" onSubmit={(event) => void save(event)}>
      <section className="shipping-setting-section">
        <div className="shipping-setting-title"><div><span className="admin-kicker">TRANSPORTE NACIONAL</span><h3>OCA e-Pak</h3><p>Podés cargar los datos cuando OCA te los entregue.</p></div><span className="shipping-credential-status">{settings.ocaConfigured && !clearOcaCredentials ? 'Datos guardados' : 'Pendiente de configuración'}</span></div>
        <div className="admin-form-grid">
          <label>Entorno<select value={settings.ocaEnvironment} onChange={(e) => update('ocaEnvironment', e.target.value as 'QA' | 'PRODUCTION')}><option value="QA">Pruebas (QA)</option><option value="PRODUCTION">Producción</option></select></label>
          <label>Usuario e-Pak<input value={ocaUsername} onChange={(e) => setOcaUsername(e.target.value)} placeholder={settings.ocaConfigured && !clearOcaCredentials ? 'Guardado · dejar vacío para conservar' : 'Usuario asignado por OCA'} /></label>
          <label>Contraseña e-Pak<input type="password" autoComplete="new-password" value={ocaPassword} onChange={(e) => setOcaPassword(e.target.value)} placeholder={settings.ocaConfigured && !clearOcaCredentials ? 'Guardada · dejar vacío para conservar' : 'Contraseña asignada por OCA'} /></label>
          <label>CUIT registrado en OCA<input inputMode="numeric" maxLength={11} value={ocaCuit} onChange={(e) => setOcaCuit(e.target.value.replace(/\\D/g, '').slice(0, 11))} placeholder="11 dígitos" /></label>
          <label>Número de operativa<input value={ocaOperative} onChange={(e) => setOcaOperative(e.target.value)} placeholder="Lo informa OCA" /></label>
        </div>
        <p className="shipping-settings-help">Para admisión y etiquetas también faltan número de cuenta, centro de costo y modalidad de despacho desde Villa Mercedes.</p>
        {settings.ocaConfigured && <div className="admin-category-actions"><button type="button" className="archive-action" onClick={() => { setClearOcaCredentials((v) => !v); setOcaUsername(''); setOcaPassword(''); setOcaCuit(''); setOcaOperative('') }}>{clearOcaCredentials ? 'Cancelar eliminación' : 'Eliminar credenciales OCA'}</button></div>}
      </section>
      <section className="shipping-setting-section">
        <div className="shipping-setting-title"><div><span className="admin-kicker">ENTREGA LOCAL</span><h3>Cadetería / mensajería</h3><p>La disponibilidad se determina por el código postal.</p></div><label className="admin-checkbox"><input type="checkbox" checked={settings.localDeliveryEnabled} onChange={(e) => update('localDeliveryEnabled', e.target.checked)} /> Habilitar entrega local</label></div>
        <div className="admin-form-grid">
          <label>Códigos postales cubiertos<input value={postalCodesText} onChange={(e) => setPostalCodesText(e.target.value)} placeholder="5730, 5732" /></label>
          <label>Precio al comprador (ARS)<input type="number" min="0" value={settings.localDeliveryFeeArs} onChange={(e) => update('localDeliveryFeeArs', Number(e.target.value))} disabled={settings.localDeliveryCoordinate} /></label>
          <label>Costo interno estimado (ARS)<input type="number" min="0" value={settings.localDeliveryInternalCostArs ?? ''} onChange={(e) => update('localDeliveryInternalCostArs', e.target.value === '' ? null : Number(e.target.value))} /></label>
        </div>
        <label className="admin-checkbox shipping-inline-check"><input type="checkbox" checked={settings.localDeliveryCoordinate} onChange={(e) => update('localDeliveryCoordinate', e.target.checked)} /> El costo se coordina después de confirmar el pedido</label>
      </section>
      <section className="shipping-setting-section">
        <div className="shipping-setting-title"><div><span className="admin-kicker">RETIRO</span><h3>Retiro por domicilio del vendedor</h3><p>Siempre es gratuito.</p></div><label className="admin-checkbox"><input type="checkbox" checked={settings.pickupEnabled} onChange={(e) => update('pickupEnabled', e.target.checked)} /> Habilitar retiro</label></div>
        <div className="admin-form-grid">
          <label className="shipping-full-field">Domicilio / punto de retiro<input value={settings.pickupAddress} onChange={(e) => update('pickupAddress', e.target.value)} required maxLength={250} /></label>
          <label className="shipping-full-field">Instrucciones<textarea value={settings.pickupInstructions} onChange={(e) => update('pickupInstructions', e.target.value)} maxLength={1000} rows={3} /></label>
        </div>
      </section>
      <div className="admin-category-actions shipping-settings-actions"><button className="admin-primary" disabled={saving}>{saving ? 'Guardando...' : 'Guardar configuración de envíos'}</button></div>
    </form>
  </section>
}
