# GOcuotas — integración API Redirect V1

## Estado

La integración está implementada en la API y configurada para Producción. La creación del checkout acepta la respuesta documentada `url_init` sin exigir un identificador no documentado. El checkout crea una orden de GOcuotas, persiste el intento y devuelve la URL de pago. La confirmación no depende del retorno del navegador: el webhook consulta la orden directamente en GOcuotas y contrasta la referencia y el importe antes de actualizar el intento y confirmar el pedido.

**Estado al 18-11-2026: Producción configurada y checkout/pago real completado.** El comprador recibió confirmación por email de GOcuotas para una compra de $1.680 en Tu TiendaVM (3 cuotas sin interés). Sin embargo, el intento correspondiente permanece `PENDING` en ecommerceVM; la conciliación del webhook sigue en revisión. No repetir el cobro.

## Datos necesarios de GOcuotas

Solicitar/obtener desde el panel de administrador de GOcuotas:

- Email de la sucursal que opera la cuenta.
- API Key correspondiente a Sandbox.
- Confirmación de que la sucursal tiene habilitado API Redirect V1.

La API Key de Sandbox se envía como el valor del campo JSON `password` en `POST /authentication`, junto con el email de la sucursal. No usar la clave de producción en Sandbox ni intercambiar credenciales entre ambientes.

Documentación recibida de GOcuotas:
- [API Redirect V1](https://gocuotas-api.stoplight.io/docs/gocuotas/dae8814842a1e-api-redirect-v1)
- [Autenticación](https://gocuotas-api.stoplight.io/docs/gocuotas/6be0e71d1c490-autenticacion)
- [API Key](https://gocuotas-api.stoplight.io/docs/gocuotas/branches/main/7jms3b3uzs6fv-api-key)

## Variables de entorno de la API

Configurar únicamente en el entorno privado de la API (Render), nunca en Vite, Git ni el navegador:

| Variable | Valor |
|---|---|
| `GOCUOTAS_API_BASE_URL` | `https://sandbox.gocuotas.com/api_redirect/v1/` |
| `GOCUOTAS_EMAIL` | Email de la sucursal |
| `GOCUOTAS_API_KEY` | API Key de Sandbox |
| `PUBLIC_APP_URL` | URL HTTPS pública del storefront |
| `PUBLIC_API_URL` | URL HTTPS pública de la API |

Las dos URLs públicas deben corresponder a los dominios desplegados. El webhook se construye como `PUBLIC_API_URL + /api/v1/payments/gocuotas/webhook`. Las variables se leen al iniciar el proceso; después de cargarlas hay que reiniciar/redeployar la API.

No pegar secretos en el chat ni incluirlos en capturas, logs o commits. Para pasar a producción se deberá confirmar el endpoint y las credenciales productivas con GOcuotas y hacer una habilitación separada y explícita.

## Flujo implementado

1. El storefront consulta `GET /api/v1/payments/gocuotas/config`.
2. El comprador selecciona GOcuotas y el backend valida que el pedido pertenezca al comprador, tenga ese medio de pago, importe final y email.
3. El backend crea un intento `CREATING` bajo bloqueo transaccional y evita duplicar intentos activos.
4. La API autentica y crea el checkout usando las rutas de API Redirect V1 bajo `/api_redirect/v1/`; la creación se realiza con `POST /checkouts` y envía el importe en centavos (`amount_in_cents`), junto con referencia única del pedido, email, teléfono, URLs de retorno y URL de webhook. El importe se envía en centavos (`amount_in_cents`), junto con referencia única del pedido, email, teléfono, URLs de retorno y URL de webhook.
5. La respuesta documentada de creación contiene `url_init`. La URL debe ser HTTPS y pertenecer a un dominio de GOcuotas antes de guardarse. El identificador del checkout es opcional en esa respuesta y se asocia al intento cuando esté disponible, por ejemplo a través del webhook.
6. El webhook acepta el identificador de orden, vuelve a autenticar y consulta `GET orders/:id` en GOcuotas. Solo considera aprobado el pago cuando la respuesta verificada tiene `delivered_at`, la referencia coincide y el importe en centavos coincide exactamente con el intento y el total vigente del pedido.
7. Si la respuesta del checkout se pierde después de enviar el POST, el intento queda `UNKNOWN` y no se genera otro checkout a ciegas. Si llega el webhook antes de persistir el ID del proveedor, se intenta correlacionar por la referencia única del pedido y asociar el ID devuelto por GOcuotas.

## Endpoints de la aplicación

- `GET /api/v1/payments/gocuotas/config`: indica si están presentes las variables requeridas. No realiza una autenticación de prueba.
- `POST /api/v1/payments/gocuotas/orders/:orderId`: crea o recupera un checkout. Requiere el token de acceso al pedido y `requestKey` UUID.
- `POST /api/v1/payments/gocuotas/webhook`: recibe la notificación y verifica el estado consultando a GOcuotas.

El webhook no confía en los campos de estado recibidos en la notificación: usa el identificador para consultar la API del proveedor. Si el intento todavía no puede correlacionarse, responde HTTP 503 para permitir que el proveedor vuelva a notificar.

## Protección ante duplicados y errores

- Rate limit en creación de checkout y webhook.
- Bloqueo transaccional por pedido y clave de solicitud UUID.
- Un checkout persistido en estado `PENDING` se reutiliza; los intentos `CREATING` o `UNKNOWN` bloquean un segundo POST.
- Fallos de autenticación anteriores al POST liberan el intento para poder reintentar.
- Una respuesta ambigua después de iniciar el POST deja el intento `UNKNOWN`; no se debe forzar otro intento hasta verificar qué ocurrió.
- La aprobación exige coincidencia de referencia e importe exacto. El retorno del navegador nunca confirma un pago.
- La aprobación no se revierte por una notificación posterior con estado pendiente.

## Prueba de aceptación y diagnóstico

La configuración y la autenticación ya fueron ejercitadas. La primera creación de checkout devolvió HTTP 201, pero la aplicación no reconoció el cuerpo de respuesta. El backend ahora registra únicamente metadatos seguros de esa respuesta en `PaymentAttempt.lastError`: código HTTP, tipo de contenido, tipo de cuerpo, nombres de campos de primer nivel y presencia/tipo de `id` y `url_init`. No registra valores del cuerpo, URLs, emails, tokens ni encabezados.

Próximos pasos:

1. Obtener de GOcuotas la estructura contractual de respuesta de `POST /checkouts` o una respuesta de ejemplo anonimizada.
2. Compararla con los metadatos guardados para el intento `UNKNOWN` y ajustar el parser/validación si corresponde.
3. Verificar con GOcuotas el estado del checkout ya enviado antes de iniciar cualquier otro POST.
4. Solo con un pedido nuevo de prueba y una respuesta reconocida, validar URL de checkout, pago Sandbox, webhook, aprobación/rechazo, idempotencia y conciliación de importes.

No repetir el POST para un intento `UNKNOWN`: el proveedor podría haber creado el checkout aunque la aplicación no haya podido interpretar su respuesta.

## Limitaciones conocidas

- El endpoint `/config` solo comprueba presencia de variables, no validez de credenciales.
- La autenticación Sandbox sí fue alcanzada en la prueba del 17-11-2026, ya que la aplicación avanzó hasta `POST /checkouts` y recibió HTTP 201.
- No se pudo validar la estructura del checkout ni confirmar que exista una URL de pago utilizable; el intento quedó `UNKNOWN` y requiere conciliación con GOcuotas.
- El webhook interpreta `status=approved` como aprobación y `status=denied` como rechazo, además de los campos temporales `delivered_at` y `discarded_at`. En todos los casos exige coincidencia exacta de referencia e importe. El comportamiento de reintentos del webhook debe seguir verificándose con GOcuotas.
- No se debe habilitar cobro real ni cambiar a credenciales productivas hasta completar Sandbox y autorizar explícitamente el paso a producción.
- No hay migración de base de datos requerida por esta integración en este cambio.

## Reintegros y cancelación administrativa

La API Redirect implementada y documentada en esta integración no contiene un endpoint de reintegro que hayamos podido validar. No se debe inventar una ruta ni asumir que el webhook de pago puede devolver dinero.

Para un pedido GOcuotas pagado que deba cancelarse:

1. Iniciar la gestión de reintegro desde el detalle del pedido en administración.
2. Ejecutar el reintegro desde el panel de GOcuotas o solicitarlo a su soporte, siguiendo las condiciones vigentes de la cuenta.
3. Verificar en GOcuotas que la devolución total esté efectivamente confirmada.
4. Recién entonces usar «Registrar reintegro ya realizado en GOcuotas» en ecommerceVM. Esta acción solo registra la confirmación manual y el administrador en el historial; no llama a GOcuotas ni mueve dinero.
5. Cancelar el pedido. La tienda repone las cantidades reservadas una sola vez.

Los intentos GOcuotas aprobados o con resultado pendiente/ incierto bloquean la cancelación. Si llega una aprobación tardía para un pedido ya cancelado, queda una alerta en el historial y no se reactiva el pedido.
