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


## Arrepentimiento del comprador y bloqueo de fulfillment

La solicitud pública `POST /api/v1/orders/regret` identifica el pedido por código y correo, registra una única solicitud idempotente bajo el bloqueo transaccional del pedido y devuelve un identificador de gestión. La tienda envía una constancia por correo con ese identificador. Si Resend no está disponible, la solicitud queda registrada y el fallo de correo se deja en logs para reintento operativo.

Mientras la solicitud está en estado `REQUESTED`, `PROCESSING` o `FAILED`, el backend bloquea:
- El paso a preparación, despacho o entrega cuando el pedido todavía no estaba en tránsito.
- La admisión OCA y la descarga de etiqueta OCA.
- Las modificaciones de datos logísticos desde administración.
- El inicio de un nuevo checkout de Mercado Pago o GOcuotas.

Los controles se repiten dentro de las transacciones que compiten por el pedido. Un webhook tardío puede registrar que el proveedor cobró, pero no confirma el pedido ni dispara el correo de compra si ya existe una solicitud de arrepentimiento. El cobro debe conciliarse y reembolsarse con el proveedor.

### Reintegro y reposición

- **Mercado Pago:** ecommerceVM solicita el reintegro mediante Orders API con idempotencia y espera la confirmación total. Si el pedido todavía no fue despachado, al confirmar el reintegro se cancela automáticamente y se repone stock en la misma transacción, una sola vez.
- **GOcuotas:** la devolución se ejecuta fuera de ecommerceVM, desde GOcuotas o con su soporte. El administrador registra la confirmación manual únicamente después de verificarla. A partir de esa constancia, los pedidos no despachados se cancelan y reponen stock automáticamente.
- **Efectivo:** el administrador registra el reintegro manual con una referencia o comprobante. El backend exige que no existan intentos online pendientes/aprobados y luego cancela y repone stock automáticamente si el pedido sigue bajo control de la tienda.
- **Devolución después del despacho:** el pedido no se cancela ni se repone stock automáticamente. La solicitud queda marcada como `RETURN_PENDING`. La administración debe registrar la recepción física con `POST /api/v1/admin/orders/:id/refund/return-received`; después de inspeccionar el artículo, registra su aceptación con `POST /api/v1/admin/orders/:id/refund/return-accepted`. Solo esta segunda acción repone stock y es idempotente. El pedido conserva su historial de envío/entrega.
- **Reembolsos parciales o intentos adicionales sin resolver:** no se consideran reintegro total. La preparación/cancelación permanece bloqueada hasta conciliar el saldo completo con el proveedor.

La confirmación manual de GOcuotas o efectivo es una declaración auditable del administrador; no significa que ecommerceVM haya movido dinero. El comprobante/referencia debe corresponder a una devolución efectivamente ejecutada.

### Alcance de plataformas externas

Este circuito solo controla pedidos creados en ecommerceVM. Si la compra se hizo directamente en Mercado Libre u otra plataforma externa, esa plataforma gestiona su propia solicitud de arrepentimiento, logística y reintegro. ecommerceVM no puede bloquear despachos ni devolver pagos que no originó.

### Pruebas automatizadas

CI ejecuta las pruebas de política y las pruebas de integración contra PostgreSQL aislado. Se verifica que un reintegro total previo al despacho cancele y reponga stock una sola vez, y que un pedido ya despachado no se cancele ni reingrese al stock sin devolución física registrada. No se usan pedidos reales ni credenciales de proveedores para estas pruebas.


### Reintegros iniciados directamente en el proveedor

Si Mercado Pago informa un reintegro total iniciado fuera de la tienda, el webhook/consulta de estado crea o actualiza el registro de gestión, registra el reintegro confirmado y aplica la misma finalización automática: cancelación y reposición de stock antes del despacho, o devolución física si el envío ya fue admitido/despachado. Los webhooks repetidos no vuelven a ingresar stock.

Si el comprador inicia una gestión directamente en GOcuotas, la tienda debe verificarla en el panel o con soporte: la integración actual no permite afirmar automáticamente que GOcuotas ya devolvió el dinero. El administrador registra esa confirmación manual una vez verificada.

En pedidos en efectivo, administración distingue entre dinero efectivamente cobrado (debe registrar el reintegro con referencia) y pedido nunca cobrado (puede cerrarse como «sin cobro», sin simular una devolución monetaria).
