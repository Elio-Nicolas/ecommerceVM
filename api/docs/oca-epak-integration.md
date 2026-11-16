# OCA e-Pak: estado técnico y plan de integración

Última revisión del repositorio: 16/11/2026.
Rama de referencia revisada: `main`.

Este documento separa lo que existe en el código de lo que todavía requiere datos comerciales o desarrollo. No considerar OCA habilitado para ventas reales hasta completar las pruebas de aceptación indicadas aquí.

## 1. Implementado en el repositorio

### Configuración administrativa
- Pantalla: `src/ShippingSettingsPanel.tsx`.
- API: `GET/PUT /api/v1/admin/shipping-settings`.
- Las credenciales de e-Pak (usuario, contraseña, CUIT y operativa) se guardan cifradas en `ShippingSettings`.
- La API no devuelve los secretos al frontend; solo expone `ocaConfigured` y `ocaEnvironment`.
- La clave recomendada para cifrado es `SHIPPING_ENCRYPTION_KEY` (mínimo 32 caracteres). No guardar credenciales ni claves en Git, issues o chats.
- El selector permite QA y producción. No seleccionar producción hasta completar QA y confirmar expresamente la habilitación comercial.

### Orígenes de despacho
- Pantalla: `src/ShippingOriginsPanel.tsx`.
- API: `GET/POST/PUT/DELETE /api/v1/admin/shipping-origins`.
- Se conserva un origen activo predeterminado, con nombre, código provincial OCA y código postal.
- La cotización toma el CP del origen activo predeterminado.

### Cotización
- Servicio: `api/src/services/oca.ts`.
- Endpoint público: `POST /api/v1/shipping/quotes`.
- Requiere credenciales OCA completas y un origen activo predeterminado.
- Requiere que cada producto tenga peso y las tres dimensiones; valida stock.
- Suma peso y volumen de los artículos según cantidades y cotiza el pedido como **un paquete** (`CantidadPaquetes=1`).
- Envía CP origen/destino, CUIT, operativa, peso en kg, volumen en m³ y valor declarado.
- Limita cotizaciones a 20 por IP cada 15 minutos.
- Persiste la cotización durante 10 minutos y la vincula al carrito mediante una huella SHA-256.
- Si faltan credenciales, origen o datos de embalaje, devuelve error y no ofrece una tarifa inventada.
- El mapeo del XML y el precio/plazo todavía necesitan validación con una respuesta real de la cuenta asignada.

### Persistencia ya preparada
El esquema Prisma ya contiene:
- `ShippingShipment`: proveedor, estado, identificador de admisión, tracking, servicio, snapshot de bultos, PDF de etiqueta, fecha de admisión/procesamiento y último error.
- Restricción única por pedido/proveedor (`@@unique([orderId, provider])`) para impedir duplicar el envío de un mismo pedido.
- `ShippingShipmentEvent`: eventos externos, payload, estado de procesamiento, reintentos y errores.
- `Order` conserva costo, carrier, tracking, servicio, cotización y snapshot de opciones.

**Importante:** que existan estos modelos no significa que ya exista el circuito OCA. En `main` todavía no hay servicio ni endpoints administrativos para crear/admitir el envío, recuperar etiquetas o sincronizar eventos OCA.

### Controles de pedidos
- El administrador puede guardar datos de envío y costo desde la gestión de pedidos.
- Para marcar un pedido OCA como enviado, el backend exige un envío OCA con estado `PROCESSED` y número de seguimiento no vacío.
- La condición se valida primero para responder rápido y se vuelve a comprobar dentro de la transacción, bajo el bloqueo por pedido, leyendo nuevamente el estado del envío. Así se evita que una validación inicial quede obsoleta por una operación concurrente.
- La misma política centralizada se aplica a Andreani y a la entrega local «A coordinar» (que requiere costo registrado); retiro y tarifas locales fijas no agregan ese requisito.
- Por lo tanto, no se puede marcar como despachado manualmente un envío OCA que todavía no fue admitido por el proveedor.

## 2. Contrato OCA oficial consultado

Documentación oficial: https://developers.oca.com.ar/epak.html

Los métodos documentados por OCA usan respuestas XML y permiten consultar el WSDL agregando `?wsdl` a la URL del servicio.

### Cotizar: `Tarifar_Envio_Corporativo`
- QA: `https://integraciones.ocadev.com.ar/epak_tracking_test/Oep_TrackEPak.asmx/Tarifar_Envio_Corporativo`
- Producción: `https://webservice.oca.com.ar/ePak_tracking/Oep_TrackEPak.asmx/Tarifar_Envio_Corporativo`
- Parámetros documentados: `PesoTotal`, `VolumenTotal`, `CodigoPostalOrigen`, `CodigoPostalDestino`, `CantidadPaquetes`, `ValorDeclarado`, `Cuit` (con guiones) y `Operativa`.
- La página oficial también documenta GET, POST, SOAP y SOAP 1.2.
- Referencia de operación y ejemplo HTTP: https://webservice.oca.com.ar/epak_tracking/Oep_TrackEPak.asmx?op=Tarifar_Envio_Corporativo

El servicio implementado construye la URL del método y realiza GET. Falta validar los valores y el XML devuelto con credenciales/datos de la cuenta comercial real.

### Crear envío: `IngresoORMultiplesRetiros_v2`
OCA documenta:
- QA: `https://integraciones.ocadev.com.ar/epak_tracking_test/Oep_TrackEPak.asmx/IngresoORMultiplesRetiros_v2`
- Producción: `https://webservice.oca.com.ar/ePak_tracking/Oep_TrackEPak.asmx/IngresoORMultiplesRetiros_v2`
- Parámetros: `usr`, `psw`, `XML_Datos`, `ConfirmarRetiro`, `ArchivoCliente` y `ArchivoProceso` (estos dos últimos son de uso interno y no se completan).
- `ConfirmarRetiro=false` deja la orden en el carrito e-Pak pendiente de confirmación; `true` confirma de inmediato.

Antes de implementar la admisión hay que obtener y validar con OCA el XML completo para la modalidad contratada, los datos de origen/destino, contacto, centro de costo, franja horaria, paquetes y modalidad de retiro/entrega. No generar XML de producción por inferencia.

### Etiquetas
OCA documenta métodos de etiquetas HTML y PDF, además de ZPL para impresoras compatibles. Entre los métodos publicados:
- `GetPdfDeEtiquetasPorOrdenOrNumeroEnvio`
- `GetPdfDeEtiquetasPorOrdenOrNumeroEnvioParaEtiquetadora`
- `GetHtmlDeEtiquetasPorOrdenOrNumeroEnvio`
- `ObtenerEtiquetasZPL`

La solicitud puede identificar la orden de retiro o el número de envío; para ZPL por bulto se requiere además el número de envío. Hay que confirmar con la cuenta qué formato usaremos. La opción inicial recomendada para la tienda es PDF A4 descargable/imprimible; no convertir HTML/ZPL a PDF sin validar el formato oficial.

### Seguimiento
OCA publica operaciones como `Tracking_Pieza`, `Tracking_PiezaExtendido` y `Tracking_PiezaNumeroEnvio`. Antes de sincronizar eventos hay que verificar el contrato y los estados/códigos exactos que devuelve la cuenta. El modelo `ShippingShipmentEvent` ya permite persistir eventos e implementar procesamiento idempotente.

## 3. Datos que debe entregar/confirmar OCA

No solicitar ni almacenar estos datos en Git:
1. CUIT habilitado y número de cuenta comercial.
2. Usuario y contraseña e-Pak.
3. Operativa asignada para el servicio elegido (puerta a puerta, puerta a sucursal u otra modalidad habilitada).
4. Centro de costo / dirección de devolución.
5. Modalidad de despacho desde Villa Mercedes: ingreso en sucursal o retiro por OCA.
6. Si hay retiro: sucursal/origen, franja horaria, días y condiciones.
7. Formato de etiqueta requerido (PDF A4 o 10×15 cm) y confirmación de impresión.
8. Credenciales y endpoint de QA habilitados para la cuenta.

No usar los usuarios/credenciales de ejemplo publicados por OCA como credenciales comerciales ni como sustituto de la cuenta del vendedor.

## 4. Próximos desarrollos, en orden seguro

1. **Diagnóstico de cuenta y QA:** comprobar autenticación, cotización, unidades, moneda, plazo y XML real; guardar ejemplos anonimizados como fixtures de pruebas.
2. **Preparación del envío:** validar que el pedido esté confirmado, pago resuelto cuando corresponda, domicilio completo, CP, origen y datos de embalaje. Mostrar un resumen al administrador antes de enviar a OCA.
3. **Admisión idempotente:** crear un registro `ShippingShipment` en estado inicial, serializar la operación por pedido y usar la restricción única existente. Manejar timeout/resultado incierto consultando OCA antes de reintentar; nunca crear una segunda orden a ciegas.
4. **Confirmación operativa:** iniciar con `ConfirmarRetiro=false` si la cuenta permite revisión en carrito; no usar confirmación inmediata hasta que el usuario apruebe el flujo.
5. **Etiqueta:** recuperar PDF oficial, validar MIME/tamaño y persistirlo en `labelPdf`; endpoint administrativo protegido para descargar/imprimir.
6. **Tracking:** consultar eventos, normalizar estados sin perder el payload original, persistir con clave externa idempotente y permitir conciliación manual.
7. **Producción:** habilitar únicamente después de QA, confirmación de OCA y aprobación expresa del titular de la tienda.

## 5. Criterios de aceptación

- Una sola admisión por pedido/proveedor, incluso ante doble clic, reintento o timeout.
- No marcar `SHIPPED` sin admisión confirmada y tracking válido.
- La etiqueta descargada corresponde al envío persistido.
- Los eventos duplicados no duplican historial ni revierten estados.
- El costo cobrado al comprador permanece separado del costo interno real.
- Los pedidos de retiro y entrega local no se envían a OCA.
- Los secretos nunca aparecen en respuestas, logs, errores ni documentación.
- La operación QA no produce despachos reales; producción permanece deshabilitada hasta aprobación explícita.

## 6. Archivos principales

- `api/src/services/oca.ts`: cliente de cotización actual.
- `api/src/routes/shipping.routes.ts`: cotización pública.
- `api/src/services/shipping-settings.ts`: configuración y descifrado de credenciales.
- `api/src/routes/admin-shipping-settings.routes.ts`: configuración protegida.
- `api/src/routes/admin-shipping-origins.routes.ts`: orígenes.
- `src/ShippingSettingsPanel.tsx`: UI de configuración.
- `src/ShippingOriginsPanel.tsx`: UI de orígenes.
- `api/prisma/schema.prisma`: modelos de envío y eventos.
- `api/src/routes/admin-orders.routes.ts`: protección del cambio a enviado.

Este documento debe actualizarse en el mismo PR que cada avance de OCA.
