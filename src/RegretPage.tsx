import { useState, type FormEvent } from 'react'

const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:7381').replace(/\/$/, '')

export default function RegretPage() {
  const [orderCode, setOrderCode] = useState('')
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setError('')
    setMessage('')
    try {
      const response = await fetch(`${API_URL}/api/v1/orders/regret`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderCode: orderCode.trim(), email: email.trim() }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload?.error?.message || 'No pudimos registrar la solicitud.')
      setMessage(payload?.message || 'Recibimos tu solicitud.')
      setOrderCode('')
      setEmail('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No pudimos registrar la solicitud.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="regret-page">
      <a href="/" className="regret-back">← Volver a Tu TiendaVM</a>
      <section className="regret-card">
        <span className="regret-kicker">TU TIENDAVM · ATENCIÓN AL CLIENTE</span>
        <h1>Arrepentimiento de compra</h1>
        <p>Ingresá el código de tu pedido y el correo utilizado al comprar. Vamos a registrar tu solicitud para que la tienda pueda revisarla.</p>
        <form onSubmit={(event) => void submit(event)}>
          <label>Código de pedido<input value={orderCode} onChange={(event) => setOrderCode(event.target.value)} placeholder="EV-XXXXXXXX-XXXXXX" maxLength={40} required /></label>
          <label>Correo electrónico de la compra<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="tu@correo.com" maxLength={160} required /></label>
          <button type="submit" disabled={busy}>{busy ? 'Enviando solicitud…' : 'Enviar solicitud de arrepentimiento'}</button>
        </form>
        {message && <p className="regret-message" role="status">{message}</p>}
        {error && <p className="regret-error" role="alert">{error}</p>}
        <small>Esta acción registra una solicitud; no ejecuta un reembolso automático. Si corresponde, la devolución se procesa mediante Mercado Pago.</small>
      </section>
      <style>{`
        .regret-page{min-height:100vh;background:#f8fafc;color:#0f172a;padding:48px 20px;display:flex;flex-direction:column;align-items:center;font-family:inherit}
        .regret-back{width:min(100%,560px);color:#0a2540;text-decoration:none;font-weight:600;margin-bottom:24px}
        .regret-card{width:min(100%,560px);background:#fff;border:1px solid #e2e8f0;border-radius:18px;padding:clamp(24px,5vw,40px);box-shadow:0 16px 48px #0f172a0d}
        .regret-kicker{font-size:11px;letter-spacing:.12em;font-weight:700;color:#64748b}
        .regret-card h1{font-size:clamp(27px,5vw,36px);line-height:1.1;margin:14px 0}
        .regret-card>p{color:#475569;line-height:1.6;margin:0 0 26px}
        .regret-card form{display:grid;gap:18px}
        .regret-card label{display:grid;gap:7px;font-size:13px;font-weight:650}
        .regret-card input{width:100%;border:1px solid #cbd5e1;border-radius:10px;padding:13px 14px;font:inherit;color:#0f172a}
        .regret-card button{border:0;border-radius:10px;background:#0a2540;color:#fff;padding:14px 18px;font:inherit;font-weight:700;cursor:pointer}
        .regret-card button:disabled{opacity:.6;cursor:wait}
        .regret-card small{display:block;color:#64748b;line-height:1.5;margin-top:22px}
        .regret-message{padding:12px;border-radius:10px;background:#ecfdf5;color:#166534}
        .regret-error{padding:12px;border-radius:10px;background:#fef2f2;color:#991b1b}
      `}</style>
    </main>
  )
}
