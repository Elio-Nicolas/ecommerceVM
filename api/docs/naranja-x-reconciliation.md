# Naranja X — conciliación normalizada

Esta etapa agrega la política pura para validar estados de pago normalizados, independiente del gateway real.

## Reglas obligatorias antes de actualizar un intento

- El ID del pago debe coincidir con el ID persistido.
- La referencia externa debe coincidir exactamente con el código del pedido.
- Importe y moneda deben coincidir con el intento y el total vigente del pedido.
- Un pago aprobado no se deduce del retorno del navegador: requiere snapshot obtenido server-to-server.
- Un reintegro parcial debe ser mayor a cero y menor al importe pagado.
- Un reintegro total debe igualar el importe pagado.
- Estados no reconocidos o datos inconsistentes quedan en `UNKNOWN`, nunca en aprobado.
- Notificaciones atrasadas no pueden degradar un pago aprobado ni reabrir un rechazo/cancelación.

## Integración pendiente

La ruta webhook/consulta deberá verificar firma y autenticidad usando el mecanismo documentado por Naranja X y luego obtener el estado canónico mediante `NaranjaXGateway.getPayment`. No se implementa validación HMAC inventada ni se acepta payload del navegador como fuente de verdad.
