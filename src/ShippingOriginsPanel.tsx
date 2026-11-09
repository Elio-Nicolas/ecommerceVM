import { useCallback, useEffect, useState, type FormEvent } from 'react'

const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:7381').replace(/\/$/, '')

type ShippingOrigin = {
  id: string
  name: string
  provinceCode: string
  postalCode: string
  enviopackAddressId: string | null
  isDefault: boolean
  isActive: boolean
}

type OriginForm = {
  name: string
  provinceCode: string
  postalCode: string
  enviopackAddressId: string
  isDefault: boolean
  isActive: boolean
}

const emptyForm: OriginForm = {
  name: '',
  provinceCode: 'S',
  postalCode: '',
  enviopackAddressId: '',
  isDefault: false,
  isActive: true,
}

export default function ShippingOriginsPanel({ token }: { token: string }) {
  const [origins, setOrigins] = useState<ShippingOrigin[]>([])
  const [form, setForm] = useState<OriginForm>(emptyForm)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(false)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const loadOrigins = useCallback(async () => {
    setLoading(true)
    try {
      const response = await fetch(`${API_URL}/api/v1/admin/shipping-origins`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload?.error?.message || 'No se pudieron cargar los depósitos.')
      setOrigins(payload.data as ShippingOrigin[])
      setError('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudieron cargar los depósitos.')
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => { void loadOrigins() }, [loadOrigins])

  function editOrigin(origin: ShippingOrigin) {
    setEditingId(origin.id)
    setForm({
      name: origin.name,
      provinceCode: origin.provinceCode,
      postalCode: origin.postalCode,
      enviopackAddressId: origin.enviopackAddressId || '',
      isDefault: origin.isDefault,
      isActive: origin.isActive,
    })
    setExpanded(true)
    setError('')
    setNotice('')
  }

  function resetForm() {
    setEditingId(null)
    setForm(emptyForm)
  }

  async function saveOrigin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    setError('')
    setNotice('')
    try {
      const response = await fetch(`${API_URL}/api/v1/admin/shipping-origins${editingId ? `/${editingId}` : ''}`, {
        method: editingId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          ...form,
          enviopackAddressId: form.enviopackAddressId.trim() || null,
        }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload?.error?.message || 'No se pudo guardar el depósito.')
      setNotice(editingId ? 'Depósito actualizado.' : 'Depósito agregado.')
      resetForm()
      await loadOrigins()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo guardar el depósito.')
    } finally {
      setSaving(false)
    }
  }

  async function removeOrigin(origin: ShippingOrigin) {
    if (!window.confirm(`¿Eliminar el depósito "${origin.name}"?`)) return
    setError('')
    setNotice('')
    try {
      const response = await fetch(`${API_URL}/api/v1/admin/shipping-origins/${origin.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}))
        throw new Error(payload?.error?.message || 'No se pudo eliminar el depósito.')
      }
      setNotice('Depósito eliminado.')
      if (editingId === origin.id) resetForm()
      await loadOrigins()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo eliminar el depósito.')
    }
  }

  return (
    <section className="admin-category-card">
      <div className="admin-category-heading">
        <h2>Depósitos de despacho</h2>
        <p>Configurá desde dónde se preparan los envíos. El identificador corresponde al depósito registrado en Envíopack.</p>
      </div>
      <div className="admin-category-actions">
        <button type="button" className="admin-primary" onClick={() => { setExpanded((value) => !value); if (expanded) resetForm() }}>
          {expanded ? 'Cerrar formulario' : '＋ Agregar depósito'}
        </button>
      </div>
      {notice && <div className="admin-alert success">{notice}</div>}
      {error && <div className="admin-alert error">{error}</div>}
      {expanded && (
        <form className="admin-category-form" onSubmit={saveOrigin}>
          <label>Nombre identificador<input value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} required minLength={2} maxLength={100} placeholder="Casa · Villa Mercedes" /></label>
          <label>Código de provincia<input value={form.provinceCode} onChange={(event) => setForm((current) => ({ ...current, provinceCode: event.target.value.toUpperCase() }))} required minLength={1} maxLength={1} placeholder="S" /></label>
          <label>Código postal (4 dígitos)<input value={form.postalCode} onChange={(event) => setForm((current) => ({ ...current, postalCode: event.target.value.replace(/\D/g, '').slice(0, 4) }))} required inputMode="numeric" pattern="\d{4}" placeholder="5730" /></label>
          <label>ID del depósito en Envíopack <span>(opcional hasta configurar la cuenta)</span><input value={form.enviopackAddressId} onChange={(event) => setForm((current) => ({ ...current, enviopackAddressId: event.target.value }))} maxLength={100} placeholder="ID asignado por Envíopack" /></label>
          <label className="admin-checkbox"><input type="checkbox" checked={form.isDefault} onChange={(event) => setForm((current) => ({ ...current, isDefault: event.target.checked }))} /> Usar como origen predeterminado</label>
          <label className="admin-checkbox"><input type="checkbox" checked={form.isActive} onChange={(event) => setForm((current) => ({ ...current, isActive: event.target.checked }))} /> Activo</label>
          <div className="admin-category-actions">
            <button className="admin-primary" disabled={saving}>{saving ? 'Guardando...' : editingId ? 'Guardar cambios' : 'Agregar depósito'}</button>
            {editingId && <button type="button" className="admin-quiet-button" onClick={resetForm}>Cancelar edición</button>}
          </div>
        </form>
      )}
      {loading ? <div className="admin-table-empty">Cargando depósitos...</div> : (
        <div className="admin-category-list">
          {origins.length === 0 ? <div className="admin-table-empty">Todavía no configuraste depósitos de despacho.</div> : origins.map((origin) => (
            <div className="admin-category-row" key={origin.id}>
              <div>
                <strong>{origin.name} {origin.isDefault ? '· Predeterminado' : ''}</strong>
                <small>Provincia {origin.provinceCode} · CP {origin.postalCode} · {origin.isActive ? 'Activo' : 'Inactivo'} · Envíopack: {origin.enviopackAddressId || 'pendiente de configurar'}</small>
              </div>
              <div>
                <button type="button" onClick={() => editOrigin(origin)}>Editar</button>
                <button type="button" className="archive-action" onClick={() => void removeOrigin(origin)}>Eliminar</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
