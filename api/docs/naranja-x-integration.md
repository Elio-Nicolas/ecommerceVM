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
