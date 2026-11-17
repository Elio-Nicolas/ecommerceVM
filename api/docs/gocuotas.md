# GOcuotas — integración API Redirect V1

## Estado

La integración está implementada en la API y preparada para configurar primero Sandbox. El checkout crea una orden de GOcuotas, persiste el intento y devuelve la URL de pago. La confirmación no depende del retorno del navegador: el webhook consulta la orden directamente en GOcuotas y contrasta la referencia y el importe antes de actualizar el intento y confirmar el pedido.

**Todavía no está validada contra una cuenta real de Sandbox.** Faltan el email de la sucursal y la API Key del ambiente. La presencia de variables habilita el endpoint de configuración, pero no demuestra que las credenciales sean válidas; eso se comprueba con la primera autenticación real.

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
4. La API autentica con `POST authentication` y crea el checkout con `POST checkouts`. El importe se envía en centavos (`amount_in_cents`), junto con referencia única del pedido, email, teléfono, URLs de retorno y URL de webhook.
5. La URL de checkout debe ser HTTPS y pertenecer a un dominio de GOcuotas antes de guardarse.
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

## Prueba de aceptación pendiente (requiere credenciales Sandbox)

1. Cargar las cinco variables anteriores en el entorno de prueba de la API y reiniciar el servicio.
2. Consultar `GET /api/v1/payments/gocuotas/config`; debe devolver `enabled: true`.
3. Crear un pedido de prueba con GOcuotas y un importe final conocido.
4. Iniciar el checkout y confirmar que devuelve una URL HTTPS de GOcuotas.
5. Completar el flujo de pago de prueba con los medios/casos que indique GOcuotas.
6. Verificar que el webhook llega a la URL pública, que la API consulta la orden al proveedor y que solo un pago aprobado confirma el pedido.
7. Reenviar la misma notificación y comprobar que no duplica cambios ni historial.
8. Verificar un pago rechazado/descartado y que el pedido no se confirma.
9. Probar un importe/referencia que no coincida, y confirmar que no se aprueba.
10. Revisar logs sin exponer API Key, token de autenticación ni datos sensibles.

## Limitaciones conocidas

- No se ejecutó una autenticación ni un checkout real: faltan credenciales Sandbox.
- El endpoint `/config` solo comprueba presencia de variables, no validez de credenciales.
- La API de GOcuotas y el contrato comercial deben confirmar los estados exactos de rechazo/cancelación y el comportamiento de reintentos del webhook durante la prueba de aceptación.
- No se debe habilitar cobro real ni cambiar a credenciales productivas hasta completar Sandbox y autorizar explícitamente el paso a producción.
- No hay migración de base de datos requerida por esta integración en este cambio.
