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

## Checkout e importes — revisión pendiente

Mientras GOcuotas queda bloqueado, revisar el checkout existente sin alterar integraciones productivas.

Criterios comerciales conversados:
- El comprador debe elegir el medio de pago antes de confirmar.
- Efectivo conserva el precio publicado como referencia.
- Mercado Pago y GOcuotas deben reflejar al comprador el costo/recargo correspondiente al medio de pago, de forma visible e inmediata antes de confirmar.
- Se conversó para GOcuotas un recargo del 9,9% + IVA; verificar cómo está expresado y calculado en el código antes de darlo por implementado.
- Verificar también las condiciones/plazos de financiación de GOcuotas y que el total mostrado coincida con el importe enviado al proveedor.
- El pedido debe guardar correctamente el medio de pago y el importe final cobrado.
- No asumir que estos criterios ya están implementados: **son puntos de auditoría y prueba**.

## Secuencia recomendada de trabajo

1. Revisar en código el cálculo de precio por medio de pago y su presentación en checkout.
2. Verificar que el precio/recargo se recalcula al cambiar el medio de pago y antes de confirmar.
3. Verificar que el backend vuelve a calcular/validar el importe; no confiar únicamente en el frontend.
4. Confirmar que el pedido conserva proveedor, importe y estado de pago correctos.
5. Ejecutar pruebas de efectivo y Mercado Pago únicamente en un entorno de pruebas aislado.
6. Retomar GOcuotas cuando Sandbox autentique.
7. Revisar CI/PR y recién entonces decidir merge y despliegue.

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

**Punto de reanudación:** revisar primero el estado local de Git; luego reintentar autenticación Sandbox después del horario anunciado. En paralelo, auditar checkout y cálculo de importes sin hacer compras reales ni desplegar cambios.
