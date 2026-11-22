# Política de automatización fiscal de ecommerceVM

## Objetivo operativo

La tienda debe emitir y entregar comprobantes sin intervención rutinaria del titular. La integración fiscal se conecta a ARCA una vez que se configure el CUIT, certificado, clave privada, punto de venta y parámetros del receptor.

## Criterio de emisión

- Un pedido se factura únicamente con un pago confirmado por el proveedor y conciliado con el pedido (referencia, moneda e importe exactos), o con efectivo recibido y registrado.
- El retorno del navegador, una preferencia creada, un checkout abierto o un webhook no verificado no constituyen pago confirmado.
- El comprobante estándar del monotributista es Factura C (código 11); el comprobante correctivo es Nota de Crédito C (código 13).
- La emisión se dispara al confirmarse el pago. Si ARCA no está disponible, se crea una tarea persistente y se reintenta con backoff, consultando primero el número reservado para descartar que ARCA haya autorizado la solicitud cuya respuesta se perdió.
- Nunca se repite FECAESolicitar con un resultado ambiguo. Primero FECompConsultar para el mismo punto de venta, tipo y número.
- La factura autorizada y el CAE son inmutables. Una cancelación posterior se documenta con Nota de Crédito C, no borrando ni editando la factura.

## Matriz de escenarios

| Escenario | Decisión fiscal |
|---|---|
| Pago pendiente, rechazado, cancelado o incierto | No facturar |
| Pago aprobado y pedido confirmado | Emitir una Factura C |
| Webhook repetido / doble evento | Idempotencia por pedido y tipo de comprobante |
| Pedido cancelado con pago tardío | Bloquear y conciliar; no facturar |
| Arrepentimiento solicitado antes de emitir | Suspender factura hasta resolver cobro/reintegro |
| ARCA rechaza comprobante | Registrar rechazo; consultar numeración antes de reintentar |
| Timeout o respuesta ambigua de ARCA | Conciliar comprobante exacto; jamás emitir otro a ciegas |
| Factura ya autorizada | No emitir otra |
| Reintegro iniciado pero no confirmado | No emitir nota de crédito todavía |
| Reintegro total confirmado con factura autorizada | Nota de Crédito C total |
| Reintegro parcial confirmado con factura autorizada | Nota de Crédito C parcial por el importe reintegrado |
| Reintegro confirmado antes de emitir factura | No emitir factura ni nota de crédito |
| Devolución después del despacho | Mantener trazabilidad logística; no reingresar stock hasta recepción e inspección |
| Nota de crédito ya emitida | No duplicar |
| GOcuotas | El sistema registra el reintegro sólo después de confirmación manual en el panel del proveedor; no puede automatizar una API que el proveedor no ofrece |
| Mercado Pago | Reintegro automático sólo si el endpoint confirma el resultado; estado incierto se consulta antes de repetir |
| Efectivo | Se factura cuando la tienda registra el dinero recibido; pedido sin cobro no se factura |

## Datos de receptor

Para que la emisión sea automática, checkout debe capturar o permitir completar los datos fiscales mínimos del receptor, con validación de tipo y número de documento y condición frente al IVA. El sistema debe consultar a ARCA la tabla vigente de condiciones IVA del receptor y no fijar IDs numéricos sin verificar la tabla del servicio. Debe definirse un perfil de Consumidor Final para compradores que no soliciten identificación, respetando los umbrales de identificación vigentes al momento de emitir.

## Reintentos y observabilidad

- Clave idempotente por pedido + tipo + versión/importe del ajuste.
- Reserva serializada de numeración por punto de venta y tipo.
- Estados separados: pendiente, emitiendo, autorizado, rechazado, desconocido.
- Reintento automático con backoff para errores transitorios; no reintentar un rechazo de negocio ni un resultado ambiguo sin consulta.
- Registro de request/response saneado, CAE, vencimiento, número y hash del PDF.
- Alertas sólo por datos fiscales incompletos, rechazo definitivo, discrepancia de importes o intervención externa requerida.
- Cola persistente y worker recuperable tras reinicios; la disponibilidad de ARCA nunca debe bloquear el cobro ni provocar duplicados.

## Alcance de proveedores

- Mercado Pago: el proveedor soporta reembolso API y consulta de estado.
- GOcuotas: el flujo actual de ecommerceVM exige confirmación manual del reintegro en el panel GOcuotas. La nota de crédito puede automatizarse después de registrar la confirmación; el reembolso al comprador no se debe declarar automático.
- Efectivo: requiere registrar cobro real.
- Ventas directas externas a la tienda (por ejemplo, Mercado Libre) no deben facturarse desde ecommerceVM salvo que se incorporen y concilien formalmente esos pedidos para evitar duplicación de comprobantes.

## Preparación de alta ARCA

Antes de habilitar producción: certificado y clave asociados al servicio Facturación Electrónica, CUIT, punto de venta Web Service, condición fiscal del emisor, domicilio, perfil de receptor, tabla de condiciones IVA y pruebas de homologación de Factura C / Nota de Crédito C. La documentación vigente de WSFEv1 publicada por ARCA es la referencia técnica para la integración.
