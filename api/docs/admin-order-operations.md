# Operación administrativa de pedidos

## Impresión de comprobantes y preparación

La administración de pedidos ofrece dos salidas de impresión:

- **Imprimir ticket:** comprobante del pedido con cliente, artículos, medio y estado del pago, desglose de importes y total.
- **Etiqueta de preparación:** lista de artículos y cantidades para preparar el pedido.
- **Impresión por lote:** genera una hoja por pedido seleccionado, con salto de página entre pedidos.

La vista de impresión se aísla del layout de administración. Las reglas de impresión deben mantener el contenedor raíz y el área imprimible fuera del grid de pantalla, ocultar el resto de la interfaz y evitar un salto de página posterior a la última hoja. La salida se configura en A4; el resultado final debe verificarse también en la vista previa del navegador y en una impresora real antes de considerarlo validado operativamente.

## Entrega local «A coordinar»

El costo de entrega coordinado se registra desde el detalle del pedido. Al guardarlo:

1. Se persiste el costo acordado y se recalcula el total del pedido, incluido el recargo del medio de pago cuando corresponda.
2. Se agrega un evento al historial con el texto `Costo de entrega local coordinado:`.
3. El pedido conserva su estado actual. Registrar el importe no equivale a confirmar el pedido ni a marcarlo como preparado/despachado.
4. El administrador debe usar **Confirmar costo y continuar** (cuando el pedido está pendiente) para avanzar el estado después de verificar el acuerdo con el comprador.

Por eso, inmediatamente después de registrar el costo, el historial puede mostrar que el pedido continúa «Pendiente» junto con el evento «Costo de entrega coordinado». Es deliberado: registra una actualización logística sin fingir una transición de estado.

## Controles

- No se puede confirmar ni despachar una entrega local «A coordinar» mientras el costo siga sin definirse.
- Si existe un intento de pago que bloquea cambios de importe, el backend rechaza la modificación del costo.
- El importe acordado se suma al total del comprador; el costo interno estimado de entrega local es información administrativa y no se mezcla con el importe cobrado.

## Cancelación y reintegros de pagos online

La cancelación administrativa consulta los intentos de **todos los proveedores online** (Mercado Pago y GOcuotas):

- Un pago aprobado o parcialmente reembolsado bloquea la cancelación. Primero debe completarse el reintegro con el proveedor.
- Un pago en creación, pendiente o con resultado incierto también bloquea la cancelación. No se permite forzarla como pedido de prueba, porque un webhook tardío podría confirmar un cobro después de reponer el stock.
- Un pago rechazado, cancelado por el proveedor o totalmente reembolsado permite cancelar el pedido. La reposición de stock ocurre dentro de la transacción de cambio de estado y una sola vez.
- Si un webhook de GOcuotas informa aprobación después de que el pedido ya fue cancelado, el pedido no se reactiva ni se envía el correo de confirmación: se agrega una alerta al historial para conciliación manual.

### Mercado Pago

Desde el detalle administrativo se inicia la gestión de reintegro. La tienda utiliza el endpoint de reembolso de Orders API con clave de idempotencia y consulta el estado si la solicitud quedó en proceso. El pedido sigue sin cancelarse hasta que Mercado Pago confirme el reintegro total. Después se puede cancelar y reponer el stock.

### GOcuotas

La integración API Redirect utilizada por esta tienda no tiene un endpoint de reintegro documentado/validado en el contrato disponible. Por eso ecommerceVM **no intenta ejecutar una devolución**: el administrador debe realizarla desde el panel de GOcuotas o con soporte del proveedor. Solo después de verla confirmada puede usar «Registrar reintegro ya realizado en GOcuotas». Esa acción registra la confirmación manual y la identidad del administrador en el historial; no mueve dinero. Luego se cancela el pedido desde el flujo normal.

La cancelación del pedido y la devolución física del producto son procesos separados. La tienda no repone stock por registrar un reintegro: el stock se repone al cancelar el pedido.
