# Naranja X — intentos persistentes

Esta etapa reutiliza `PaymentAttempt` existente. Su campo `provider` es texto, por lo que `NARANJA_X` no requiere una migración de base de datos.

## Flujo implementado

1. Rechaza la operación si la feature flag está desactivada.
2. Valida pedido no cancelado, total entero positivo y URLs HTTPS.
3. Persiste un intento `CREATING` con clave de idempotencia única.
4. Solicita checkout al gateway inyectado.
5. Verifica ID, referencia, importe, moneda, estado inicial pendiente y URL HTTPS.
6. Persiste el ID externo, URL y snapshot saneado como `PENDING`.
7. Ante error o respuesta ambigua conserva el intento como `UNKNOWN`; el reintento debe reutilizar la misma clave.

No se crea una segunda tentativa activa para el mismo pedido. El adaptador Prisma usa la tabla `PaymentAttempt` ya existente.

## Límites deliberados

- `NARANJA_X_ENABLED` queda en `false` por defecto.
- No se registra una ruta pública ni se agrega Naranja X al checkout.
- El simulador sólo se usa en tests; no se instancia desde runtime.
- No se implementan HTTP, autenticación, firma webhook ni reintegros sin documentación oficial.
- La feature flag no debe activarse hasta disponer de gateway, credenciales y contrato confirmado por Naranja X.
