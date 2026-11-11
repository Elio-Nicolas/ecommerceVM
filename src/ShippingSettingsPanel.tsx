import { useEffect, useState, type FormEvent } from 'react'

const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:7381').replace(/\/$/, '')

type ShippingSettings = {
  enviopackEnabled: boolean
  enviopackConfigured: boolean
  ocaEnvironment: 'QA' | 'PRODUCTION'
  ocaConfigured: boolean
  pickupEnabled: boolean
  pickupAddress: string
  pickupInstructions: string
  localDeliveryEnabled: boolean
  localDeliveryPostalCodes: string[]
  localDeliveryFeeArs: number
  localDeliveryInternalCostArs: number | null
  localDeliveryCoordinate: boolean
}

const defaults: ShippingSettings = {
  enviopackEnabled: false,
  enviopackConfigured: false,
  ocaEnvironment: 'QA',
  ocaConfigured: false,
  pickupEnabled: true,
  pickupAddress: 'Domicilio del vendedor',
  pickupInstructions: 'La dirección exacta y el horario se coordinarán luego de confirmar el pedido.',
  localDeliveryEnabled: false,
  localDeliveryPostalCodes: ['5730'],
  localDeliveryFeeArs: 0,
  localDeliveryInternalCostArs: null,
  localDeliveryCoordinate: false,
}

export default function ShippingSettingsPanel({ token }: { token: string }) {
  const [settings, setSettings] = useState<ShippingSettings>(defaults)
  const [apiKey, setApiKey] = useState('')
  const [secretKey, setSecretKey] = useState('')
  const [ocaUsername, setOcaUsername] = useState('')
  const [ocaPassword, setOcaPassword] = useState('')
  const [ocaCuit, setOcaCuit] = useState('')
  const [ocaOperative, setOcaOperative] = useState('')
  const [clearOcaCredentials, setClearOcaCredentials] = useState(false)
  const [postalCodesText, setPostalCodesText] = useState('5730')
  const [clearCredentials, setClearCredentials] = useState(false)
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
    request<{ data: ShippingSettings }>('/admin/shipping-settings')
      .then(({ data }) => {
        if (!active) return
        setSettings(data)
        setPostalCodesText(data.localDeliveryPostalCodes.join(', '))
      })
      .catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : 'No se pudo cargar la configuración.') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [token])

  function update<K extends keyof ShippingSettings>(key: K, value: ShippingSettings[K]) {
    setSettings((current) => ({ ...current, [key]: value }))
  }

  async function testConnection() {
    if (testing) return
    if (Boolean(apiKey.trim()) !== Boolean(secretKey.trim())) {
      setError('Ingresá la API Key y la Secret Key juntas para probar la conexión.')
      return
    }
    setTesting(true)
    setError('')
    setNotice('')
    try {
      const result = await request<{ message: string }>('/admin/shipping-settings/test', {
        method: 'POST',
        body: JSON.stringify({ ...(apiKey.trim() && secretKey.trim() ? { apiKey: apiKey.trim(), secretKey: secretKey.trim() } : {}) }),
      })
      setNotice(result.message || 'Conexión con Envíopack verificada correctamente.')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo verificar la conexión.')
    } finally {
      setTesting(false)
    }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (saving) return
    setSaving(true)
    setError('')
    setNotice('')
    if (Boolean(apiKey.trim()) !== Boolean(secretKey.trim())) {
      setError('Ingresá la API Key y la Secret Key juntas para actualizar las credenciales.')
      setSaving(false)
      return
    }
    const ocaValues = [ocaUsername.trim(), ocaPassword.trim(), ocaCuit.trim(), ocaOperative.trim()]
    if (ocaValues.some(Boolean) && !ocaValues.every(Boolean)) {
      setError('Para guardar OCA completá usuario, contraseña, CUIT y operativa.')
      setSaving(false)
      return
    }
    if (clearOcaCredentials && ocaValues.some(Boolean)) {
      setError('No podés reemplazar y eliminar las credenciales OCA en la misma operación.')
      setSaving(false)
      return
    }
    const postalCodes = [...new Set(postalCodesText.split(',').map((value) => value.trim()).filter(Boolean))]
    const payload = {
      ...settings,
      localDeliveryPostalCodes: postalCodes,
      localDeliveryInternalCostArs: settings.localDeliveryInternalCostArs === null ? null : Number(settings.localDeliveryInternalCostArs),
      ...(apiKey.trim() && secretKey.trim() ? { enviopackApiKey: apiKey.trim(), enviopackSecretKey: secretKey.trim() } : {}),
      ...(clearCredentials ? { clearEnviopackCredentials: true } : {}),
      ...(ocaUsername.trim() && ocaPassword.trim() && ocaCuit.trim() && ocaOperative.trim()
        ? { ocaUsername: ocaUsername.trim(), ocaPassword: ocaPassword.trim(), ocaCuit: ocaCuit.trim(), ocaOperative: ocaOperative.trim() }
        : {}),
      ...(clearOcaCredentials ? { clearOcaCredentials: true } : {}),
    }
    try {
      const result = await request<{ data: ShippingSettings }>('/admin/shipping-settings', {
        method: 'PUT',
        body: JSON.stringify(payload),
      })
      setSettings(result.data)
      setPostalCodesText(result.data.localDeliveryPostalCodes.join(', '))
      setApiKey('')
      setSecretKey('')
      setClearCredentials(false)
      setOcaUsername('')
      setOcaPassword('')
      setOcaCuit('')
      setOcaOperative('')
      setClearOcaCredentials(false)
      setNotice('Configuración de envíos guardada. OCA permanece pendiente de habilitación comercial y técnica.')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo guardar la configuración.')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <section className="admin-category-card"><div className="admin-table-empty">Cargando configuración de envíos...</div></section>

  return (
    <section className="admin-category-card shipping-settings-card">
      <div className="admin-category-heading">
        <h2>Configuración de envíos y entregas</h2>
        <p>Administrá las modalidades, tarifas y credenciales desde acá. No necesitás editar variables de entorno ni reiniciar la API.</p>
      </div>
      {error && <div className="admin-alert error">{error}</div>}
      {notice && <div className="admin-alert success">{notice}</div>}
      <form className="shipping-settings-form" onSubmit={(event) => void save(event)}>
        <section className="shipping-setting-section">
          <div className="shipping-setting-title"><div><span className="admin-kicker">ENVÍOS NACIONALES</span><h3>Envíopack</h3><p>Las credenciales se cifran en la base de datos y nunca se vuelven a mostrar en pantalla.</p></div><label className="admin-checkbox"><input type="checkbox" checked={settings.enviopackEnabled} onChange={(event) => update('enviopackEnabled', event.target.checked)} /> Habilitar Envíopack</label></div>
          <div className="admin-form-grid">
            <label>API Key<input type="password" autoComplete="new-password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={settings.enviopackConfigured && !clearCredentials ? 'Credencial guardada · dejar vacío para conservar' : 'Ingresar API Key'} /></label>
            <label>Secret Key<input type="password" autoComplete="new-password" value={secretKey} onChange={(event) => setSecretKey(event.target.value)} placeholder={settings.enviopackConfigured && !clearCredentials ? 'Credencial guardada · dejar vacío para conservar' : 'Ingresar Secret Key'} /></label>
          </div>
          <div className="shipping-credential-status"><span className={settings.enviopackConfigured && !clearCredentials ? 'shipping-status-dot is-ready' : 'shipping-status-dot'} />{settings.enviopackConfigured && !clearCredentials ? 'Credenciales almacenadas' : 'Credenciales pendientes'}{settings.enviopackConfigured && <button type="button" className="archive-action" onClick={() => { const next = !clearCredentials; setClearCredentials(next); setApiKey(''); setSecretKey(''); if (next) update('enviopackEnabled', false) }}>{clearCredentials ? 'Cancelar eliminación' : 'Eliminar credenciales'}</button>}</div>
          <div className="admin-category-actions"><button type="button" className="admin-quiet-button" onClick={() => void testConnection()} disabled={testing}>{testing ? 'Probando conexión...' : 'Probar conexión con Envíopack'}</button></div>
          <p className="shipping-settings-help">Para cotizar también necesitás configurar un depósito predeterminado en la sección “Depósitos de despacho” y completar peso y dimensiones en cada producto.</p>
        </section>

        <section className="shipping-setting-section">
          <div className="shipping-setting-title">
            <div>
              <span className="admin-kicker">TRANSPORTE NACIONAL</span>
              <h3>OCA e-Pak</h3>
              <p>Prepará la cuenta de OCA. Las cuatro credenciales se cifran en el backend y nunca se muestran nuevamente.</p>
            </div>
            <span className={settings.ocaConfigured && !clearOcaCredentials ? 'shipping-credential-status' : 'shipping-credential-status'}>
              {settings.ocaConfigured && !clearOcaCredentials ? 'Cuenta configurada' : 'Cuenta pendiente'}
            </span>
          </div>
          <div className="admin-form-grid">
            <label>Entorno
              <select value={settings.ocaEnvironment} onChange={(event) => update('ocaEnvironment', event.target.value as 'QA' | 'PRODUCTION')}>
                <option value="QA">Pruebas (QA)</option>
                <option value="PRODUCTION">Producción</option>
              </select>
              <small>Producción queda seleccionada solo cuando OCA habilite la cuenta. Esto no activa envíos.</small>
            </label>
            <label>Usuario e-Pak<input type="text" autoComplete="off" value={ocaUsername} onChange={(event) => setOcaUsername(event.target.value)} placeholder={settings.ocaConfigured && !clearOcaCredentials ? 'Credencial guardada · dejar vacío para conservar' : 'Usuario asignado por OCA'} /></label>
            <label>Contraseña e-Pak<input type="password" autoComplete="new-password" value={ocaPassword} onChange={(event) => setOcaPassword(event.target.value)} placeholder={settings.ocaConfigured && !clearOcaCredentials ? 'Credencial guardada · dejar vacío para conservar' : 'Contraseña asignada por OCA'} /></label>
            <label>CUIT registrado en OCA<input inputMode="numeric" maxLength={11} value={ocaCuit} onChange={(event) => setOcaCuit(event.target.value.replace(/\D/g, '').slice(0, 11))} placeholder="11 dígitos" /></label>
            <label>Número de operativa<input value={ocaOperative} onChange={(event) => setOcaOperative(event.target.value)} placeholder="Operativa confirmada por OCA" /></label>
          </div>
          <div className="shipping-settings-help">
            La integración no se habilita al guardar estos datos. Primero deben confirmarse con OCA la operativa, modalidad de despacho desde Villa Mercedes y acceso QA. No ingreses aquí credenciales de Envíopack.
          </div>
          {settings.ocaConfigured && <div className="admin-category-actions"><button type="button" className="archive-action" onClick={() => { setClearOcaCredentials((value) => !value); setOcaUsername(''); setOcaPassword(''); setOcaCuit(''); setOcaOperative('') }}>{clearOcaCredentials ? 'Cancelar eliminación' : 'Eliminar credenciales OCA'}</button></div>}
        </section>

        <section className="shipping-setting-section">
          <div className="shipping-setting-title"><div><span className="admin-kicker">ENTREGA LOCAL</span><h3>Cadetería / mensajería</h3><p>La disponibilidad se determina por el código postal del destino, no por la ubicación del comprador.</p></div><label className="admin-checkbox"><input type="checkbox" checked={settings.localDeliveryEnabled} onChange={(event) => update('localDeliveryEnabled', event.target.checked)} /> Habilitar entrega local</label></div>
          <div className="admin-form-grid">
            <label>Códigos postales cubiertos<input value={postalCodesText} onChange={(event) => setPostalCodesText(event.target.value)} placeholder="5730, 5732" /><small>Separalos con coma. Solo códigos de cuatro dígitos.</small></label>
            <label>Precio al comprador (ARS)<input type="number" min="0" max="2000000000" step="1" value={settings.localDeliveryFeeArs} onChange={(event) => update('localDeliveryFeeArs', Number(event.target.value))} disabled={settings.localDeliveryCoordinate} /></label>
            <label>Costo interno estimado (ARS)<input type="number" min="0" max="2000000000" step="1" value={settings.localDeliveryInternalCostArs ?? ''} onChange={(event) => update('localDeliveryInternalCostArs', event.target.value === '' ? null : Number(event.target.value))} placeholder="Opcional" /></label>
          </div>
          <label className="admin-checkbox shipping-inline-check"><input type="checkbox" checked={settings.localDeliveryCoordinate} onChange={(event) => update('localDeliveryCoordinate', event.target.checked)} /> El costo se coordina después de confirmar el pedido</label>
        </section>

        <section className="shipping-setting-section">
          <div className="shipping-setting-title"><div><span className="admin-kicker">RETIRO</span><h3>Retiro por domicilio del vendedor</h3><p>Siempre es gratuito y no depende del código postal del comprador.</p></div><label className="admin-checkbox"><input type="checkbox" checked={settings.pickupEnabled} onChange={(event) => update('pickupEnabled', event.target.checked)} /> Habilitar retiro</label></div>
          <div className="admin-form-grid">
            <label className="shipping-full-field">Domicilio / punto de retiro<input value={settings.pickupAddress} onChange={(event) => update('pickupAddress', event.target.value)} required maxLength={250} /></label>
            <label className="shipping-full-field">Instrucciones<textarea value={settings.pickupInstructions} onChange={(event) => update('pickupInstructions', event.target.value)} maxLength={1000} rows={3} /></label>
          </div>
        </section>
        <div className="admin-category-actions shipping-settings-actions"><button className="admin-primary" disabled={saving}>{saving ? 'Guardando...' : 'Guardar configuración de envíos'}</button></div>
      </form>
    </section>
  )
}
