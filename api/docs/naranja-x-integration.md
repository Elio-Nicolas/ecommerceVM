# Naranja X — adaptador desacoplado

## Estado

Esta etapa incorpora el contrato interno del proveedor y un simulador determinista para pruebas automatizadas. No habilita Naranja X en el checkout ni realiza llamadas de red. El simulador usa exclusivamente `naranja-x-simulator.invalid`, dominio reservado que no puede cobrar.

## Contrato

`NaranjaXGateway` define dos operaciones independientes del proveedor:
- `createCheckout`: crea una intención de pago y devuelve ID, URL, importe, moneda, referencia y estado.
- `getPayment`: consulta el estado canónico del pago al proveedor.

La aplicación deberá validar siempre referencia externa, importe, moneda y asociación con el pedido antes de aprobar un intento. La aprobación no debe derivarse del retorno del navegador.

## Lo que falta confirmar con Naranja X

No implementar contra endpoints inferidos. Antes de crear el adaptador HTTP real se necesita:
- Gateway habilitado para el comercio 260043812 y modalidad autorizada.
- Documentación técnica aplicable a comercios, no solo a socios estratégicos.
- URL base y endpoints de checkout/consulta.
- Autenticación, firma y formato exacto de webhooks.
- Campos de referencia, importe, moneda y estados terminales.
- API y reglas para anulaciones/reintegros.
- Credenciales de sandbox y criterios de certificación.

## Próxima etapa técnica

1. Implementar el cliente HTTP concreto detrás de `NaranjaXGateway`.
2. Persistir intentos con `provider = NARANJA_X`, clave idempotente única y asociación al pedido.
3. Agregar webhook con verificación criptográfica según el contrato oficial, consulta server-to-server y conciliación.
4. Exponer el medio en checkout solo cuando esté habilitado y configurado.
5. Integrar reintegros únicamente si la API del canal los soporta y confirma el resultado.

Mercado Pago y GOcuotas permanecen sin cambios. No agregar secretos ni activar producción en esta etapa.


## Transporte HTTP preparado (sin contrato supuesto)

Se agregó `NaranjaXHttpClient` como transporte JSON aislado:
- Solo admite una URL base HTTPS.
- Solo acepta rutas relativas al host configurado; bloquea URLs absolutas y cambios de host.
- Permite inyectar headers de autenticación y un `fetch` controlado, sin fijar un esquema de credenciales.
- Aplica timeout, bloquea redirects y normaliza errores de red/HTTP/JSON sin exponer cuerpos de respuesta ni detalles internos.
- Tiene pruebas automatizadas con respuestas simuladas; no realiza llamadas reales.

Este transporte todavía **no implementa `NaranjaXGateway`**: los paths, serializadores, esquemas de respuesta, autenticación y firma webhook deben ajustarse al contrato que Naranja X confirme para este comercio. La documentación pública de Checkout Externo es una pista técnica, pero no acredita acceso del comercio ni sustituye las credenciales y el contrato de homologación.

## Política de medios de pago

La validación de disponibilidad del backend ahora usa una política centralizada y testeada. Solo permite CASH, MERCADO_PAGO y GOCUOTAS cuando su setting correspondiente está activo. Cualquier valor desconocido —incluido NARANJA_X mientras no esté integrado— falla cerrado. El esquema de creación de pedidos continúa rechazando métodos no habilitados en checkout.


## Adaptador HTTP implementado por contrato inyectable

Se agregó `NaranjaXHttpGateway`, que implementa el contrato interno `NaranjaXGateway` y utiliza el transporte HTTP aislado. El protocolo específico se inyecta mediante `NaranjaXProtocolCodec`, responsable de:
- construir requests de creación y consulta;
- aportar autenticación y headers requeridos;
- definir paths y payloads oficiales;
- parsear respuestas reales y mapear estados al modelo interno.

El adaptador valida antes de devolver resultados: URL de checkout HTTPS, coincidencia de referencia/importe/moneda, ID del pago consultado, estados conocidos y consistencia de importes reintegrados. Tiene pruebas automatizadas con codec y servidor simulados.

**Esto completa el esqueleto ejecutable de integración, no la integración comercial real.** Aún falta escribir el codec concreto cuando Naranja X confirme la API habilitada para este comercio. No se incluye firma de webhook porque el algoritmo, canonicalización y headers deben salir de la documentación oficial; inventarlos sería inseguro.
