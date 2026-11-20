export default function RegretPolicyPage() {
  return (
    <main className="regret-policy-page">
      <a href="/" className="regret-policy-back">← Volver a Tu TiendaVM</a>
      <article className="regret-policy-card">
        <span className="regret-policy-kicker">TU TIENDAVM · INFORMACIÓN PARA COMPRADORES</span>
        <h1>Derecho de arrepentimiento</h1>
        <p className="regret-policy-lead">Si realizaste una compra a distancia y decidís dejarla sin efecto, podés ejercer tu derecho de arrepentimiento en los términos previstos por la normativa de defensa del consumidor.</p>

        <section>
          <h2>¿Cuál es el plazo?</h2>
          <p>Tenés <strong>10 días corridos</strong> para revocar la aceptación. El plazo se cuenta desde la entrega del producto o desde la celebración del contrato, lo que ocurra último.</p>
        </section>
        <section>
          <h2>¿Tiene algún costo?</h2>
          <p>El ejercicio de este derecho no tiene penalidades ni cargos para vos. Los gastos que demande la devolución del producto están a cargo de la parte vendedora, conforme al artículo 34 de la Ley 24.240.</p>
        </section>
        <section>
          <h2>¿Cómo inicio la solicitud?</h2>
          <ol>
            <li>Ingresá al botón <strong>“Iniciar solicitud”</strong>.</li>
            <li>Completá el código de pedido y el correo electrónico utilizado en la compra.</li>
            <li>La tienda recibirá tu presentación y se pondrá en contacto para coordinar la devolución del producto, si corresponde.</li>
          </ol>
          <p>La solicitud queda registrada para su gestión. El envío del formulario no realiza un reembolso automático ni reemplaza la coordinación de la devolución.</p>
        </section>
        <section>
          <h2>¿Qué pasa después?</h2>
          <p>Una vez recibida la solicitud, verificaremos los datos del pedido y nos comunicaremos para coordinar los pasos necesarios. Si corresponde una restitución de importes, se gestionará por el medio de pago utilizado o por el mecanismo que corresponda según el caso.</p>
        </section>
        <section className="regret-policy-note">
          <h2>Marco normativo</h2>
          <p>Esta información se brinda de acuerdo con el artículo 34 de la Ley 24.240 de Defensa del Consumidor y el artículo 1.110 del Código Civil y Comercial de la Nación. La normativa vigente contempla supuestos específicos de excepción, que se analizarán conforme a las características de cada operación.</p>
          <a href="https://www.argentina.gob.ar/normativa/nacional/ley-24240-638/actualizacion" target="_blank" rel="noreferrer">Consultar Ley 24.240 en Argentina.gob.ar ↗</a>
        </section>
        <a className="regret-policy-cta" href="/arrepentimiento">Iniciar solicitud de arrepentimiento</a>
      </article>
      <style>{`
        .regret-policy-page{min-height:100vh;background:#f8fafc;color:#0f172a;padding:42px 20px 64px;display:flex;flex-direction:column;align-items:center;font-family:inherit}
        .regret-policy-back{width:min(100%,760px);color:#0a2540;text-decoration:none;font-size:13px;font-weight:700;margin-bottom:22px}
        .regret-policy-card{width:min(100%,760px);background:#fff;border:1px solid #e2e8f0;border-radius:18px;padding:clamp(24px,5vw,48px);box-shadow:0 16px 48px #0f172a0d}
        .regret-policy-kicker{font-size:11px;letter-spacing:.12em;font-weight:800;color:#64748b}
        .regret-policy-card h1{font-size:clamp(30px,5vw,42px);line-height:1.12;letter-spacing:-.04em;margin:14px 0}
        .regret-policy-lead{font-size:16px;line-height:1.75;color:#475569;margin:0 0 30px}
        .regret-policy-card section{padding:22px 0;border-top:1px solid #e8edf2}
        .regret-policy-card h2{font-size:17px;margin:0 0 10px;color:#0a2540}
        .regret-policy-card section p,.regret-policy-card li{font-size:14px;line-height:1.8;color:#475569}
        .regret-policy-card section p{margin:0 0 10px}
        .regret-policy-card ol{padding-left:22px;margin:10px 0}
        .regret-policy-note{background:#f8fafc;padding:20px!important;border:1px solid #e2e8f0!important;border-radius:12px;margin-top:12px}
        .regret-policy-note a{display:inline-block;margin-top:8px;color:#0a568c;font-size:13px;font-weight:700}
        .regret-policy-cta{display:flex;align-items:center;justify-content:center;min-height:50px;margin-top:26px;padding:0 20px;border-radius:9px;background:#0a2540;color:#fff;text-decoration:none;font-size:14px;font-weight:800;text-align:center}
        .regret-policy-cta:hover{background:#173b5d}
      `}</style>
    </main>
  )
}
