# Naranja X — discovery técnica para ecommerceVM

Estado: investigación y diseño previo. No habilita cobros ni modifica el checkout productivo.

## 1. Conclusión ejecutiva

Hay dos caminos técnicamente plausibles, todavía sujetos a confirmación comercial:

1. **Checkout/API directa de Naranja X.** El portal público de Checkout Externo documenta creación de intenciones, consulta de estado y webhooks firmados. El portal indica que la solución está destinada a socios estratégicos; no hay evidencia pública de que el comercio 260043812 tenga acceso ni de que el alta de comercio por sí sola habilite estas APIs.
2. **Gateway/adquirente (Payway, Fiserv u otro indicado por Naranja X).** ecommerceVM puede integrarse con un gateway vía backend. Sin embargo, falta confirmar que ese gateway pueda asociar el número de comercio Naranja X del titular y que respete sus planes de financiación y liquidación. Una integración de Payway/Fiserv no implica automáticamente procesar el merchant ID de Naranja X.

No se debe implementar un flujo de producción hasta tener confirmación escrita del canal, credenciales sandbox, contrato de webhooks y documentación de anulaciones/reintegros.

## 2. Evidencia pública consultada

- Naranja X — portal Checkout Externo: https://e3-checkout-connect-portal.naranjax.com/
- Naranja X — integración técnica: https://e3-checkout-connect-portal.naranjax.com/integracion-tecnica
  - Base API publicada: `https://api.naranjax.com/external-checkout/v1`
  - `GET /health`
  - `POST /{partner_id}/payments/{order_id}` para intención de pago
  - `GET /{partner_id}/payments/{order_id}/status` para consulta
  - Solicitud de reversa: endpoint aún por definir en la documentación pública consultada.
  - Webhooks: header `X-NX-Signature`, firma HMAC-SHA256 con secret del partner; idempotencia por `order_id`; Naranja X menciona reintentos exponenciales.
  - Go-live requiere credenciales productivas y certificación end-to-end.
- Naranja X Comercios: https://www.naranjax.com/comercios
  - Informa que hay soluciones API/plugins para ecommerce, con onboarding adicional para soluciones avanzadas.
- Payway Ventas Online: https://www.payway.com.ar/vender-online
  - Publica integración API/SDK para desarrollos a medida y SDK Node.js.
- Payway Developers: https://developers.payway.com.ar/
- Fiserv Ecommerce: https://www.fiserv.com.ar/pago-para-ecommerce/
  - Publica solución Gateway Posnet; la habilitación y las tarjetas/marcas concretas dependen del contrato del comercio.

**Límite de evidencia:** los documentos públicos describen capacidades de producto, no prueban que el número de comercio asignado al titular esté habilitado para una API, un gateway específico, ni que se mantengan sus planes comerciales.

## 3. Arquitectura actual de ecommerceVM observada en main

- Backend Express + TypeScript, Prisma y PostgreSQL.
- `PaymentAttempt` ya tiene `provider` como String, `requestKey` único, `providerOrderId` único, `checkoutUrl`, importe, moneda, estado y payload de respuesta. Esto permite agregar un proveedor sin una migración de enum para el campo provider.
- `Order.paymentMethod` es String; el alta del método nuevo requiere ampliar validaciones Zod, cálculo de checkout y frontend, no cambiar un enum SQL.
- Mercado Pago se implementa en `api/src/routes/payments.routes.ts`.
- GOcuotas se implementa de forma separada en `api/src/routes/gocuotas.routes.ts`.
- El checkout crea el pedido en `api/src/routes/orders.routes.ts`.
- `api/src/services/payment-validation.ts` valida URLs de checkout de los proveedores actuales; deberá extenderse con allowlist específica de Naranja X o, preferentemente, validadores por proveedor.
- `api/src/services/checkout-pricing.ts` define los métodos permitidos y recargos. El recargo de Naranja X no debe copiar el de Mercado Pago ni GOcuotas: debe configurarse según contrato y planes habilitados.
- `api/src/app.ts` monta los routers de pagos.
- La transición a pedido confirmado se realiza desde el estado verificado del proveedor, no debe depender del redirect del navegador.

## 4. Diseño propuesto — adaptador independiente

Agregar un router y servicio propios, sin mezclar la lógica de MP/GOcuotas:

- `api/src/routes/naranja-x.routes.ts`
- `api/src/services/naranja-x-client.ts`
- `api/src/services/naranja-x-signature.ts`
- `api/src/services/naranja-x-payment-policy.ts`
- Tests unitarios y de integración simulada.

Endpoints internos sugeridos:

- `GET /api/v1/payments/naranja-x/config`: expone únicamente si el proveedor está habilitado; nunca secretos.
- `POST /api/v1/payments/naranja-x/orders/:orderId`: valida token de acceso del pedido, medio elegido, estado, total definitivo y ausencia de pago aprobado; crea/reutiliza un PaymentAttempt idempotente y solicita checkout al proveedor.
- `POST /api/v1/payments/naranja-x/webhook`: valida firma HMAC, identifica la operación, consulta estado server-to-server cuando corresponda y aplica una transición idempotente.
- `GET /api/v1/payments/naranja-x/orders/:orderId/status` o integración al endpoint de estado común: consulta estado real del proveedor para recuperar webhooks demorados.
- Endpoint administrativo de conciliación restringido a ADMIN para operaciones UNKNOWN.

Flujo:
1. El frontend muestra Naranja X solo si `NARANJA_X_ENABLED` y la configuración está completa.
2. El cliente selecciona Naranja X; el backend registra el pedido con `paymentMethod = NARANJA_X`.
3. El backend crea o reutiliza PaymentAttempt con requestKey idempotente y el importe exacto del pedido.
4. Se solicita intención/checkout al proveedor y se persiste el identificador externo y URL validada.
5. El comprador completa el pago en el checkout oficial.
6. El webhook se autentica y la operación se consulta server-to-server antes de marcar APPROVED.
7. Se valida coincidencia de order reference, merchant/account, importe, moneda y estado final.
8. Solo entonces se confirma el pedido y se dispara el flujo existente de correo/facturación.
9. Reintentos, notificaciones duplicadas y estados ambiguos se concilian sin crear un segundo cobro.

## 5. Seguridad y confiabilidad obligatorias

- Secretos exclusivamente en variables de entorno de Render; nunca en frontend, repositorio, logs ni conversación.
- Configuración inicial apagada por defecto.
- Verificación HMAC-SHA256 de `X-NX-Signature` con comparación de tiempo constante.
- Confirmar con Naranja X si la firma se calcula sobre el cuerpo HTTP crudo. El middleware actual de Express usa `express.json()`; si el contrato requiere bytes originales, habrá que capturar `rawBody` de forma específica para esta ruta antes de parsear JSON.
- Idempotencia local por pedido/intento y según clave exigida por Naranja X.
- No confiar en query params ni URL de retorno como prueba de pago.
- Comparar importe exacto, moneda ARS, referencia del pedido, ID de operación y comercio.
- Estados desconocidos o timeout: conservar `UNKNOWN`, consultar estado antes de reintentar creación o reversa.
- Nunca volver a cobrar automáticamente una operación cuyo resultado externo sea incierto.
- Webhook repetido debe ser inocuo.
- No registrar PAN, CVV, credenciales ni payloads con datos sensibles.
- Anulaciones/reintegros solo si el proveedor documenta endpoint y permisos; hasta entonces, conciliación/operación manual explícita.

## 6. Variables de entorno propuestas (nombres provisionales)

- `NARANJA_X_ENABLED=false`
- `NARANJA_X_API_BASE_URL`
- `NARANJA_X_PARTNER_ID`
- `NARANJA_X_API_KEY` o mecanismo de autenticación que confirme NX
- `NARANJA_X_WEBHOOK_SECRET`
- `NARANJA_X_MERCHANT_ID` (si la API requiere el número de comercio)
- `NARANJA_X_CHECKOUT_MODE` (solo si NX confirma más de un modo)

Los nombres y el esquema de autenticación son preliminares; no asumir que el portal público usa API key si no lo confirma el contrato entregado al comercio.

## 7. Pruebas automatizadas previstas

- Configuración ausente/deshabilitada: no mostrar ni aceptar Naranja X.
- Checkout: pedido inexistente, token inválido, medio distinto, total pendiente, pedido cancelado, pago previo aprobado.
- Idempotencia: misma requestKey, requestKey conflictiva, timeout después de que NX haya creado la intención.
- Respuesta de checkout: URL no HTTPS/no permitida, ID ausente, referencia o importe diferente.
- Webhook: firma válida/inválida, firma vencida si aplica, cuerpo alterado, duplicado, replay, payload malformado.
- Conciliación: aprobado, rechazado, pendiente, cancelado, desconocido, operación no encontrada.
- Seguridad de negocio: pago tardío en pedido cancelado, importe/moneda/referencia/comercio distintos, dos intentos concurrentes.
- Regresión: Mercado Pago y GOcuotas conservan sus rutas y políticas actuales.
- Reembolsos: solo cuando NX confirme endpoints y semántica; probar reembolso total/parcial, duplicado, timeout y consulta de estado.

## 8. Información pendiente de Naranja X

1. ¿El comercio 260043812 puede usar Checkout Externo/API directamente o requiere gateway/partner?
2. Si requiere gateway: ¿qué proveedor puede asociar exactamente ese número de comercio a una tienda de desarrollo propio?
3. ¿Se puede integrar con Payway/Fiserv/Mobex/VTEX/Lira? ¿Cuál es el alta y qué contrato/costo adicional aplica?
4. ¿Se mantienen Plan Z, cuotas y condiciones de acreditación del alta al operar vía ecommerce/gateway?
5. ¿Hay sandbox, credenciales, OpenAPI/Swagger y proceso de certificación?
6. ¿Formato exacto del webhook, algoritmo/canonicalización de firma, tolerancia temporal y política de reintentos?
7. ¿Endpoints y permisos de consulta, anulación y reintegro total/parcial?
8. ¿Qué datos de conciliación/settlement entrega el portal y con qué frecuencia?

## 9. Criterio para iniciar implementación

Iniciar implementación productiva únicamente cuando exista:
- canal de integración confirmado para este comercio;
- documentación técnica completa y vigente;
- credenciales sandbox;
- definición de webhook/firma e idempotencia;
- definición de consultas y reintegros;
- confirmación de marcas, planes, comisiones y liquidación.

Hasta entonces, el trabajo permitido es diseño, tests de contrato con fixtures simulados y estructura aislada sin activar el método en checkout ni afectar los medios existentes.
