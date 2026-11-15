# Continuidad técnica — ecommerceVM / GOcuotas

**Última actualización:** 14/11/2026  
**Repositorio:** `Elio-Nicolas/ecommerceVM`  
**PR relacionado:** [#88 — feat(payments): integrar GOcuotas API Redirect V1](https://github.com/Elio-Nicolas/ecommerceVM/pull/88)

## Estado general

La integración GOcuotas está implementada en una rama de trabajo y tiene CI verde según la última revisión disponible, pero **no está mergeada ni desplegada**. No avanzar a producción hasta completar las pruebas de Sandbox y revisar el flujo de importes.

## GOcuotas — punto exacto donde quedamos

- Rama: `feat/gocuotas-redirect-v1`.
- Commit conocido al iniciar las pruebas: `b0dbfb713f58dd18dcfe33de3be54b4d6b39c8dc`.
- Base conocida: `main` en `b328e17238833333e21e3ed8508b906a5b70e741`.
- PR #88 abierto; no mergeado.
- La integración usa API Redirect V1 y autentica mediante `POST authentication` con email y contraseña de integración.
- La configuración local respondió correctamente en `GET /api/v1/payments/gocuotas/config`: `enabled=True`, proveedor `GOCUOTAS`. Esto **solo confirma presencia de configuración**, no valida las credenciales.
- Prueba directa de autenticación desde Node contra la URL configurada:
  - Base configurada: `https://sandbox.gocuotas.com/api_redirect/v1/`.
  - Endpoint probado: `POST authentication`.
  - Resultado: HTTP `401`, sin token.
  - Mensaje devuelto: “Tu email, DNI o contraseña no son válidos. Revisalos e intentalo nuevamente.”
- GOcuotas mostró el aviso: “La API key de sandbox será válida a partir del 15/11/2026 a las 07:59hs.”

### Diagnóstico — no asumir la causa

El host y el endpoint respondieron, pero GOcuotas rechazó la autenticación. Todavía no está confirmado si:
1. Sandbox aún no estaba habilitado para la sucursal;
2. API Redirect V1 requiere API Key en lugar de email/contraseña;
3. las credenciales usadas no corresponden al mecanismo de autenticación de esta API; o
4. la ruta/base URL de Sandbox indicada es distinta.

La documentación compartida confirma el dominio Sandbox `https://sandbox.gocuotas.com`, pero falta confirmar con GOcuotas que la base completa `/api_redirect/v1/` y el endpoint `/authentication` sean los correctos para ese ambiente.

### Próximo paso al retomar

1. Reintentar **solo la autenticación aislada** una vez pasada la fecha/hora de habilitación anunciada (15/11/2026 07:59, hora indicada por GOcuotas).
2. No imprimir ni compartir email, contraseña, API Key ni tokens.
3. Si vuelve a dar 401, solicitar confirmación a Integraciones GOcuotas sobre:
   - mecanismo de autenticación de API Redirect V1 (email/contraseña vs API Key);
   - habilitación efectiva de Sandbox para la sucursal;
   - URL base y endpoint exactos de autenticación;
   - vigencia y tipo de credenciales entregadas.
4. No probar creación de checkout hasta conseguir autenticación válida y confirmar el entorno.
5. Después probar creación de checkout, retorno y webhook en Sandbox, validando referencia, importe y cambio de estado del pedido.

## Seguridad y límites de las pruebas

- No usar credenciales de producción.
- No cambiar variables productivas de Render ni desplegar esta rama.
- No ejecutar compras de prueba contra la API productiva.
- El endpoint de configuración no valida autenticación.
- La ruta de creación de checkout registra un `PaymentAttempt`; además, las URLs públicas configuradas localmente apuntaban a los dominios productivos. Por eso no se debe usar esa ruta hasta aislar y confirmar un backend/base de datos de pruebas.
- No mergear PR #88 hasta resolver autenticación y completar las pruebas de Sandbox.

## Checkout e importes — auditoría inicial del código (14/11/2026)

Revisión estática de `src/CheckoutPage.tsx`, `api/src/routes/orders.routes.ts`, `api/src/routes/payments.routes.ts` y `api/src/routes/gocuotas.routes.ts`, sobre la rama `feat/gocuotas-redirect-v1`. No se ejecutaron compras ni se modificó lógica de negocio.

### Hallazgos confirmados

1. **No existe opción de efectivo en el selector actual.** El checkout solo ofrece Mercado Pago y GOcuotas cuando están habilitados.
2. **No se calcula recargo por proveedor en el checkout.** El backend de órdenes calcula `totalArs` como subtotal de productos + envío. No recibe ni calcula un medio de pago ni un recargo.
3. **El importe enviado a ambos proveedores es el total base del pedido.** Mercado Pago usa `order.totalArs`; GOcuotas usa `prepared.order.totalArs * 100`. No se observa en estos flujos un ajuste del 9,9% + IVA ni otro recargo según medio de pago.
4. **El pedido se crea antes de iniciar el pago.** Al confirmar, el frontend registra el pedido y luego llama automáticamente al proveedor seleccionado. La selección entre Mercado Pago y GOcuotas queda en estado del frontend; el endpoint de creación de orden no recibe el proveedor. El proveedor queda asociado al `PaymentAttempt` cuando se inicia el pago.
5. **No hay una pantalla previa que presente el total ajustado por medio de pago antes de registrar el pedido.** El comprobante posterior muestra el total base del pedido.
6. **Riesgo de reintento/cambio de proveedor a revisar.** La interfaz permite iniciar nuevamente el pago desde el comprobante usando el proveedor actualmente seleccionado. Debe definirse cómo se evita que un mismo pedido termine con intentos activos de distintos proveedores y cómo se informa el importe final al comprador.

### Qué significa

La integración técnica de GOcuotas en el PR no implementa todavía el modelo comercial conversado de precio final según medio de pago. Tampoco está implementado el flujo de efectivo en el selector actual. Estos son faltantes de producto/backend, independientes del 401 de Sandbox.

### Criterios comerciales definidos para implementar

- **Efectivo:** conserva exactamente el precio publicado. No se le agrega recargo.
- **GOcuotas:** se suma al precio base un 11,979% (9,9% + IVA del 21% aplicado sobre esa comisión). Ejemplo: base $100.000 → recargo $11.979 → total comprador $111.979. El recargo se calcula sobre el subtotal de productos más el envío confirmado.
- **Mercado Pago:** el checkout debe mostrar un importe final calculado con la comisión configurada para la modalidad/costo real de MP. No inventar una tasa fija: dejarla parametrizada y documentar el valor pendiente de confirmar antes de habilitar cobros.
- Los importes se expresan en pesos enteros; redondeo al peso más cercano y validación de límites en backend.
- El backend calcula y valida el precio final; el frontend solo muestra una cotización previa.
- El pedido debe persistir medio elegido, subtotal, envío, recargo y total final. El intento de pago debe usar exactamente ese total.
- Reintentos del mismo medio reutilizan el importe/orden; cambiar de medio exige recalcular y evitar dos intentos cobrables simultáneos.
- El stock no se descuenta al mostrar la cotización. Se valida y descuenta dentro de la transacción al confirmar el pedido.

## Diseño visual requerido para el checkout

- Interfaz moderna, limpia y de alto contraste; tipografía sans-serif legible (preferencia Poppins/Manrope) y jerarquía tipográfica clara.
- Paleta de referencia: fondo claro `#F8FAFC`, texto oscuro `#0F172A`, azul profundo `#0A2540` y acento coral/rojo `#E11D48`.
- Tarjetas de selección para cada medio de pago, con estado seleccionado claramente visible, precio final grande y recargo desglosado en texto legible.
- Resumen del pedido actualizado inmediatamente al cambiar el medio de pago. Efectivo debe destacar como precio sin recargo; GOcuotas debe indicar explícitamente el 11,979% adicional.
- Evitar textos diminutos, grises de bajo contraste, estilos genéricos de plantilla y cambios visuales que mezclen la marca de la tienda con IORed.

## Secuencia recomendada de trabajo

1. Definir la fórmula comercial exacta para efectivo, Mercado Pago y GOcuotas (incluyendo qué significa 9,9% + IVA y sobre qué importe se aplica).
2. Diseñar el flujo para elegir medio de pago y ver el total final **antes** de registrar el pedido o reservar stock.
3. Implementar el cálculo autoritativo en backend y reflejarlo en checkout.
4. Persistir de forma consistente el proveedor elegido y el importe aplicable al pedido/intento.
5. Definir y probar idempotencia y reglas para cambiar/reintentar proveedor sin duplicar cobros.
6. Ejecutar pruebas de efectivo y Mercado Pago únicamente en un entorno de pruebas aislado.
7. Retomar GOcuotas cuando Sandbox autentique; probar checkout, retorno y webhook.
8. Revisar CI/PR y recién entonces decidir merge y despliegue.

## Estado local de Git al pausar

En el equipo local se informó:
- Se estaba en `main` y se cambió correctamente a `feat/gocuotas-redirect-v1`.
- Se guardó temporalmente `api/prisma/schema.prisma` mediante stash con mensaje: `respaldo schema antes de probar GOcuotas`.
- Permanecían archivos no trackeados: `api/package-lock.json` y `api/test-db.cjs`.

**Importante al volver al equipo:** revisar `git status --short` y `git stash list` antes de cambiar de rama, aplicar stash, descartar archivos o hacer pull. No borrar ni agregar esos archivos no trackeados sin inspeccionarlos. No aplicar el stash a ciegas: comparar primero el schema de la rama con el guardado.

## Configuración y secretos

Las variables requeridas por la rama incluyen:
- `GOCUOTAS_API_BASE_URL`
- `GOCUOTAS_EMAIL`
- `GOCUOTAS_PASSWORD`
- `PUBLIC_APP_URL`
- `PUBLIC_API_URL`

No guardar valores reales en este documento, en Git ni en capturas. La configuración local ya llegó a mostrar `enabled=True`, pero la autenticación no fue exitosa.

---

**Punto de reanudación:** primero revisar el estado local de Git; luego reintentar autenticación Sandbox después del horario anunciado. En paralelo, definir fórmula y flujo de importes por medio de pago antes de modificar el checkout. No hacer compras reales ni desplegar cambios durante esta etapa.


## Avance de checkout iniciado

Commits posteriores al diagnóstico:

- `26e2ca6`: se agregó `api/src/services/checkout-pricing.ts`, calculador puro de precios en servidor para efectivo, Mercado Pago y GOcuotas.
- `5b659b6` / `a889d55`: pruebas unitarias para precio en efectivo, recargo GOcuotas, tasa configurable de Mercado Pago, redondeo y validaciones.
- `2cf58d2`: actualización visual de `src/checkout.css` con fondo `#F8FAFC`, azul `#0A2540`, texto `#0F172A`, acento `#E11D48`, tarjetas seleccionadas más claras y tipografía más legible.

**Importante: avance parcial, todavía no integrado al flujo de compra.** El calculador aún no está conectado a `orders.routes.ts`, no hay endpoint de cotización de total por medio de pago, no se persistieron medio/recargo/total final en `Order`, y el checkout todavía no ofrece efectivo ni muestra el total dinámico por medio. Tampoco se ejecutaron CI ni pruebas desde este entorno. No mergear ni desplegar este estado.

Siguiente implementación obligatoria:

1. Agregar configuración validada para tasa de recargo de Mercado Pago; mantenerla en cero/deshabilitada hasta confirmar costo real, sin inventar porcentaje.
2. Crear cotización de checkout en backend que valide productos/stock y modalidad/envío, calcule el precio según medio y devuelva subtotal, envío, recargo y total. La cotización no descuenta stock.
3. Persistir en `Order` el medio elegido, importe base, recargo y total cobrado; migración Prisma correspondiente.
4. Cambiar creación de pedido para recalcular todo dentro de la transacción, verificar que la cotización siga vigente y recién ahí reservar stock. Idempotencia debe incluir medio de pago.
5. Habilitar efectivo como pedido sin pasarela; Mercado Pago y GOcuotas deben crear PaymentAttempt con el mismo importe final guardado en Order.
6. Actualizar checkout y comprobante para mostrar desglose y total actualizado en cuanto se cambia el medio. Reintentos y cambio de proveedor deben impedir intentos cobrables simultáneos.
7. Ejecutar pruebas API, Prisma generate, TypeScript build y CI. Revisar migración antes de cualquier despliegue.

## Continuación 2026-11-14 — checkout y precios por medio de pago

Implementado en esta rama:
- Selector de efectivo/transferencia coordinada, Mercado Pago y GOcuotas (los medios online solo aparecen cuando su configuración está habilitada).
- Efectivo conserva el precio publicado y no suma recargo.
- GOcuotas aplica 11,979% sobre productos + envío.
- Mercado Pago usa `MP_CHECKOUT_SURCHARGE_MILLIPERCENT`; valor por defecto 0 porque no se definió todavía una comisión para trasladar al comprador. La unidad es milésima de punto porcentual: 5000 equivale a 5%.
- El checkout muestra subtotal, envío, recargo y total estimado al cambiar el medio.
- El backend vuelve a calcular el importe con los precios reales de catálogo y la cotización de envío validada; no confía en importes enviados por el navegador.
- La orden persiste `paymentMethod`, `paymentSurchargeMilliPercent` y `paymentSurchargeArs`.
- Los endpoints de Mercado Pago y GOcuotas rechazan iniciar un pago si el proveedor no coincide con el medio guardado en la orden.
- Al confirmar o corregir manualmente un costo de entrega local u OCA, el backend recalcula total y recargo con el medio de pago original. Si ya hay un intento de pago abierto/cerrado que bloquea cambios, no permite modificar el total.
- Migración nueva: `20261114190000_checkout_payment_pricing`.

Pendiente de validación:
- CI del último commit y build de Vercel.
- Ejecutar Prisma deploy/generate, tests y build en CI.
- Revisar el resultado visual del checkout y hacer una compra controlada con efectivo; no realizar cobros reales.
- GOcuotas Sandbox sigue bloqueado por el HTTP 401 previo. Reintentar autenticación después de la hora de habilitación informada por GOcuotas (15/11/2026 07:59 hora Argentina).
- No hacer merge ni desplegar producción hasta validar CI y el flujo. No modificar credenciales productivas.

Validación CI:
- GitHub Actions run #611: **success**.
- `prisma migrate deploy`: success (incluye la migración nueva).
- `prisma generate`: success.
- Tests API: 46/46 passed.
- TypeScript build API: success.
- Frontend build: success.
- Preview Vercel del último ajuste de checkout: success.
