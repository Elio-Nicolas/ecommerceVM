import { useState, type FormEvent } from 'react'

const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:7381').replace(/\/$/, '')

type OcaOrder = {
  id: string
  code: string
  status: string
  deliveryMethod: string
  customerName: string
  customerEmail: string | null
  customerPhone: string
  city: string
  province: string
  postalCode: string | null
  paymentReceivedAt: string | null
  paymentAttempts?: { provider: string; status: string; approvedAt: string | null }[]
  shipments?: { provider: string; status: string; trackingNumber: string | null }[]
}

export default function OcaAdmissionPanel({ order, token, onComplete }: { order: OcaOrder; token: string; onComplete: () => void }) {
  const existing = order.shipments?.find((shipment) => shipment.provider === 'OCA')
  const paid = Boolean(order.paymentReceivedAt) || (order.paymentAttempts || []).some((attempt) => attempt.status === 'APPROVED' && Boolean(attempt.approvedAt))
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [street, setStreet] = useState('')
  const [number, setNumber] = useState('')
  const [postalCode, setPostalCode] = useState(order.postalCode || '')
  const [locality, setLocality] = useState(order.city)
  const [province, setProvince] = useState(order.province)
  const [phone, setPhone] = useState(order.customerPhone)
  const [email, setEmail] = useState(order.customerEmail || '')
  const [heightCm, setHeightCm] = useState('10')
  const [widthCm, setWidthCm] = useState('20')
  const [lengthCm, setLengthCm] = useState('30')
  const [weightKg, setWeightKg] = useState('1')
  const [saving, setSaving] = useState(false)
  const [feedback, setFeedback] = useState('')

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    setFeedback('')
    try {
      const response = await fetch(`${API_URL}/api/v1/admin/orders/${order.id}/oca-admission`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          recipient: { firstName, lastName, street, number, postalCode, locality, province, phone, email: email || undefined },
          parcel: { heightCm: Number(heightCm), widthCm: Number(widthCm), lengthCm: Number(lengthCm), weightKg: Number(weightKg) },
        }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload?.error?.message || 'No se pudo registrar la admisión en OCA QA.')
      setFeedback(payload?.message || 'Solicitud enviada a OCA QA. La orden quedó pendiente de confirmación en e-Pak.')
      onComplete()
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : 'No se pudo registrar la admisión.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="order-payment-card">
      <div className="order-payment-heading"><div><span className="admin-kicker">OCA · QA</span><h3>Admisión del envío</h3></div><small>Registro manual desde el pedido</small></div>
      {existing ? (
        <div className="order-payment-attempt"><strong>Ya existe un intento OCA</strong><small>Estado: {existing.status}{existing.trackingNumber ? ` · Seguimiento: ${existing.trackingNumber}` : ''}</small><p>No se habilita un segundo intento automático. Si el resultado fue incierto, verificá primero la operación en e-Pak.</p></div>
      ) : order.deliveryMethod !== 'OCA' || order.status !== 'PREPARING' ? (
        <p className="order-payment-empty">Disponible únicamente para pedidos OCA en preparación.</p>
      ) : !paid ? (
        <p className="order-payment-empty">El pedido todavía no tiene un pago confirmado.</p>
      ) : (
        <form className="admin-form-grid" onSubmit={submit}>
          <p className="admin-full-field">Completá los datos de destino tal como figuran en la dirección del comprador. La calle y altura se ingresan manualmente: no se deducen de una dirección libre.</p>
          <label>Nombre<input value={firstName} onChange={(event) => setFirstName(event.target.value)} required maxLength={30} /></label>
          <label>Apellido<input value={lastName} onChange={(event) => setLastName(event.target.value)} required maxLength={30} /></label>
          <label>Calle de destino<input value={street} onChange={(event) => setStreet(event.target.value)} required maxLength={30} /></label>
          <label>Altura<input value={number} onChange={(event) => setNumber(event.target.value)} required maxLength={5} /></label>
          <label>Código postal<input value={postalCode} onChange={(event) => setPostalCode(event.target.value)} required pattern="[0-9]{4}" maxLength={4} /></label>
          <label>Localidad<input value={locality} onChange={(event) => setLocality(event.target.value)} required maxLength={30} /></label>
          <label>Provincia<input value={province} onChange={(event) => setProvince(event.target.value)} required maxLength={30} /></label>
          <label>Teléfono<input value={phone} onChange={(event) => setPhone(event.target.value)} required /></label>
          <label className="admin-full-field">Correo electrónico<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
          <div className="admin-full-field"><strong>Paquete consolidado del pedido</strong><small>Ingresá las medidas del bulto completo, no las de cada unidad.</small></div>
          <label>Alto (cm)<input type="number" min="1" max="300" value={heightCm} onChange={(event) => setHeightCm(event.target.value)} required /></label>
          <label>Ancho (cm)<input type="number" min="1" max="300" value={widthCm} onChange={(event) => setWidthCm(event.target.value)} required /></label>
          <label>Largo (cm)<input type="number" min="1" max="300" value={lengthCm} onChange={(event) => setLengthCm(event.target.value)} required /></label>
          <label>Peso (kg)<input type="number" min="0.01" step="0.01" value={weightKg} onChange={(event) => setWeightKg(event.target.value)} required /></label>
          <div className="admin-full-field"><button className="admin-primary" disabled={saving}>{saving ? 'Registrando en OCA QA…' : 'Registrar admisión en OCA QA'}</button></div>
        </form>
      )}
      {feedback && <p className="order-payment-reference" role="status">{feedback}</p>}
      <p className="order-payment-empty">Se utiliza la sucursal OCA configurada como origen. Nunca se envía el domicilio particular del vendedor. La solicitud queda en e-Pak sin confirmación inmediata.</p>
    </section>
  )
}
