# Acceso privado del comprador a su pedido

## Modelo

Los endpoints de consulta del comprador y de inicio de pago requieren el header `X-Order-Access-Token`. El token se deriva mediante HMAC-SHA256 a partir de la clave idempotente del checkout y `JWT_SECRET`, con separación de dominio (`ecommercevm:order-access:v1:`). En PostgreSQL solo se almacena SHA-256 del token (`Order.customerAccessTokenHash`).

La derivación estable permite que un reintento idempotente del checkout recupere el mismo acceso sin almacenar el token en claro ni crear otro pedido. La comparación del hash usa `timingSafeEqual`.

## Endpoints protegidos

- `GET /api/v1/orders/:id/receipt`
- `GET /api/v1/payments/orders/:orderId/status`
- `POST /api/v1/payments/orders/:orderId` (Mercado Pago)
- `POST /api/v1/payments/gocuotas/orders/:orderId` (GOcuotas)

Los endpoints de consulta responden con 404 genérico tanto para un pedido inexistente como para un token ausente/inválido. El estado público devuelve únicamente el estado del pedido y el estado del intento; no expone código, importe, fecha de aprobación, detalle del proveedor ni payloads internos. Se conserva `Cache-Control: no-store` y el rate limit.

## Cliente

Al registrar o recuperar idempotentemente un pedido, la API devuelve `customerAccessToken` una sola vez en el cuerpo de creación. El checkout lo conserva en `sessionStorage` bajo una clave por pedido. El comprobante y la pantalla de retorno lo envían por header; nunca se agrega a URLs.

Los retornos de Mercado Pago y GOcuotas mantienen el UUID del pedido en la URL, pero el UUID por sí solo ya no autoriza consultas ni creación de checkouts. El proveedor se conserva en el retorno para que los reintentos usen el endpoint correcto.

## Migración y operación

La migración `20261116180000_order_customer_access_token` agrega una columna nullable. Los pedidos históricos quedan sin hash y, por diseño, no pueden usar los endpoints públicos hasta contar con un mecanismo de recuperación verificable; no se les asigna un token basado solamente en el UUID. La atención administrativa debe asistir esos casos.

`JWT_SECRET` debe permanecer estable: cambiarlo invalida los tokens de acceso de pedidos existentes. Si se rota, debe planificarse una migración de sesiones y una vía de recuperación del comprador. Nunca registrar el token en logs ni incluirlo en URLs.

## Validación

La prueba unitaria `api/test/order-access-token.test.ts` cubre derivación estable, separación entre pedidos, token correcto, ausente, incorrecto y hash inválido. CI debe ejecutar Prisma migrate deploy/generate, suite de tests, build API y build frontend antes de merge.
