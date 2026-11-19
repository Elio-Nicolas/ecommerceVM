# OCA e-Pak: estado técnico y plan de integración

Última revisión del repositorio: 16/11/2026.
Rama de referencia revisada: `main`.

Este documento separa lo que existe en el código de lo que todavía requiere datos comerciales o desarrollo. No considerar OCA habilitado para ventas reales hasta completar las pruebas de aceptación indicadas aquí.

## 1. Implementado en el repositorio

### Configuración administrativa
- Pantalla: `src/ShippingSettingsPanel.tsx`.
- API: `GET/PUT /api/v1/admin/shipping-settings`.
- Las credenciales de e-Pak (usuario, contraseña, CUIT y operativa) se guardan cifradas en `ShippingSettings`.
- Se agregaron campos cifrados para número de cuenta (`nrocuenta`), centro de costo y `idcentroimposicionorigen`, necesarios para construir la admisión.
- La API expone únicamente `ocaAdmissionConfigured`; nunca devuelve los valores descifrados. Los tres datos de admisión se guardan juntos y se validan con los formatos publicados por OCA.
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

**Importante:** que existan estos modelos no significa que ya exista el circuito OCA. Hay un generador aislado y validado del XML de admisión (`api/src/services/oca-admission-xml.ts`), pero todavía no existe el servicio de negocio ni los endpoints administrativos para admitir el envío, recuperar etiquetas o sincronizar eventos OCA.

### Controles de pedidos
- El administrador puede guardar datos de envío y costo desde la gestión de pedidos.
- Para marcar un pedido OCA como enviado, el backend exige un envío OCA con estado `PROCESSED` y número de seguimiento.
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

El parser de cotización ahora contempla importes con separadores decimales argentinos e internacionales, XML con namespaces y respuestas ASMX con XML interno escapado. El plazo solo se convierte a horas cuando OCA informa explícitamente `HorasEntrega` o `DiasEntrega`; no se deduce la unidad de un campo genérico. Hay pruebas unitarias con fixtures sintéticos. Esto endurece el procesamiento, pero no sustituye la validación con la respuesta real de la cuenta.

### Crear envío: `IngresoORMultiplesRetiros_v2`
OCA documenta:
- QA: `https://integraciones.ocadev.com.ar/epak_tracking_test/Oep_TrackEPak.asmx/IngresoORMultiplesRetiros_v2`
- Producción: `https://webservice.oca.com.ar/ePak_tracking/Oep_TrackEPak.asmx/IngresoORMultiplesRetiros_v2`
- Parámetros: `usr`, `psw`, `XML_Datos`, `ConfirmarRetiro`, `ArchivoCliente` y `ArchivoProceso` (estos dos últimos son de uso interno y no se completan).
- `ConfirmarRetiro=false` deja la orden en el carrito e-Pak pendiente de confirmación; `true` confirma de inmediato.

Antes de implementar la admisión hay que obtener y validar con OCA el XML completo para la modalidad contratada, los datos de origen/destino, contacto, centro de costo, paquetes y modalidad de entrega. La franja horaria aplica a retiro a domicilio, no a admisión en sucursal. No generar XML de producción por inferencia.

Se agregó `buildOcaAdmissionXml()` como serializador puro del contrato publicado: arma la estructura `ROWS/origenes/origen/envios/envio`, requiere la sucursal de admisión de origen, permite `idci` solo cuando el destinatario retira en sucursal y representa un único paquete consolidado por pedido (`cant=1`). Para una operativa sin seguro envía `valor=0`; solo incluye valor declarado cuando el seguro esté habilitado. Valida límites de campos, fecha, códigos postales, dimensiones y caracteres que OCA advierte que pueden fallar. La franja `idfranjahoraria` es opcional para admisión en sucursal y solo se serializa cuando se informa; OCA la exige para órdenes de retiro a domicilio. Todavía no llama al Web Service ni persiste admisiones: faltan número de cuenta, operativa, centro de costo, sucursal y datos de QA asignados a la cuenta.

### Cliente de admisión implementado

Se agregó `api/src/services/oca-admission.ts`:
- Usa el endpoint `IngresoORMultiplesRetiros_v2` del ambiente configurado y envía credenciales/XML por HTTP POST form-urlencoded (no en la URL).
- La confirmación inmediata queda desactivada por defecto. Solo se activa si el llamador la solicita explícitamente; `false` deja el envío en el carrito e-Pak para confirmación manual.
- Interpreta `OrdenRetiro`, `NumeroEnvio`, `Remito`, `Estado` y el resumen de ingresados/rechazados.
- Distingue rechazos de respuestas incompletas o timeouts. Una respuesta incierta no debe reintentarse automáticamente: primero hay que consultar e-Pak para evitar duplicar una admisión.
- Tiene pruebas con respuestas sintéticas de aceptación, rechazo, XML escapado, SOAP Fault y resultado incierto.

Este cliente todavía no se invoca desde una ruta administrativa ni persiste por sí mismo. La siguiente etapa es conectar la admisión con el pedido, completar los datos de cuenta/origen que hoy no existen en la configuración y aplicar bloqueo/idempotencia antes de hacer una llamada real.

### Etiquetas
OCA documenta métodos de etiquetas HTML y PDF, además de ZPL para impresoras compatibles.

Se agregó `api/src/services/oca-label.ts`: consulta `GetPdfDeEtiquetasPorOrdenOrNumeroEnvio` por HTTP GET en el ambiente configurado, decodifica la respuesta XML/Base64, valida firma `%PDF-` y limita el archivo a 15 MB. No inventa un PDF ni acepta respuestas de error como etiqueta. El endpoint protegido `GET /api/v1/admin/shipping-labels/orders/:orderId/oca` recupera la etiqueta para una admisión OCA ya persistida, la guarda en `ShippingShipment.labelPdf` y responde `application/pdf` para abrir/imprimir. Si ya está guardada, reutiliza la copia local y no vuelve a llamar a OCA. Requiere `externalAdmissionId`; todavía no crea la admisión ni asigna ese identificador. Entre los métodos publicados:
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
4. Número de cuenta e-Pak habilitado (formato `NNNNNN/NNN`), centro de costo retornado por `GetCentroCostoPorOperativa` e ID de sucursal de admisión retornado por `GetCentrosImposicionConServiciosByCP` para CP 5730, con servicio de admisión habilitado.
5. Centro de costo / dirección de devolución.
6. Modalidad de despacho desde Villa Mercedes: ingreso en sucursal o retiro por OCA.
7. Si hay retiro: sucursal/origen, franja horaria, días y condiciones.
8. Formato de etiqueta requerido (PDF A4 o 10×15 cm) y confirmación de impresión.
9. Credenciales y endpoint de QA habilitados para la cuenta.

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

## Consultas de metadatos en Administración

- `GET /api/v1/admin/shipping-settings/oca/admission-branches?postalCode=5730` consulta sucursales por CP y devuelve exclusivamente las que tienen el servicio OCA `IdTipoServicio=1` (Admisión de paquetes). El identificador se toma de `IdCentroImposicion`; nombre, domicilio y ubicación se leen de los nodos del centro.
- `GET /api/v1/admin/shipping-settings/oca/cost-centers` consulta centros de costo con CUIT y operativa guardados. El identificador se toma de `NroCentroCosto`.
- Los dos endpoints son administrativos, de sólo lectura y están limitados al entorno QA. Si la configuración está en Producción, responden con error controlado y no llaman al endpoint productivo.
- Las consultas no crean órdenes, no generan etiquetas y no confirman admisiones.
- El panel permite seleccionar el centro de costo y la sucursal devueltos por OCA; ambos valores se guardan cifrados junto con el resto de la configuración.

La estructura del XML de sucursales se contrastó con una respuesta SOAP documentada que contiene `CentrosDeImposicion/Centro/Servicios/Servicio`. La elegibilidad de origen se filtra por `IdTipoServicio=1`, correspondiente a Admisión de paquetes. El XML de centros de costo se procesa como `NewDataSet/Table`, tomando `NroCentroCosto`.


## Admisión administrativa en QA

La API administrativa expone `POST /api/v1/admin/orders/:id/oca-admission` (requiere sesión de administrador). La operación está limitada a pedidos OCA en estado `PREPARING`, con cobro confirmado, y a credenciales OCA configuradas en ambiente `QA`.

El cuerpo requiere los datos estructurados del destinatario y las dimensiones/peso del único bulto consolidado:

```json
{
  "recipient": {
    "firstName": "Nombre",
    "lastName": "Apellido",
    "street": "Calle destino",
    "number": "123",
    "postalCode": "5730",
    "locality": "Villa Mercedes",
    "province": "San Luis",
    "phone": "2657...",
    "email": "cliente@example.com"
  },
  "parcel": {
    "heightCm": 10,
    "widthCm": 20,
    "lengthCm": 30,
    "weightKg": 1.2
  }
}
```

Localidad, provincia y CP del destinatario deben coincidir con el pedido. Calle y altura se solicitan estructuradas para no adivinar cómo separar el domicilio guardado en `addressLine`. Las medidas son ingresadas por administración: no se suman dimensiones de productos ni se presume una geometría de embalaje.

El origen se obtiene exclusivamente de la sucursal OCA de admisión configurada y consultada por CP 5730. La ruta exige calle, altura, localidad, provincia y CP de esa sucursal; nunca usa `pickupAddress`, `ShippingOrigins` ni el domicilio particular del vendedor.

Antes de llamar a OCA se reserva un único `ShippingShipment` por pedido/proveedor bajo bloqueo transaccional. Los intentos existentes no se repiten automáticamente. Un timeout o respuesta no concluyente queda en `ADMISSION_UNKNOWN` y requiere conciliación manual en e-Pak. La llamada usa `ConfirmarRetiro=false`: registra la orden en el carrito e-Pak, sin confirmarla ni despacharla. Un resultado aceptado queda en `ADMITTED`; no habilita por sí solo marcar el pedido como `SHIPPED`, que continúa condicionado al procesamiento y tracking.

Esta ruta es backend-only por ahora; todavía no hay formulario de admisión en el panel administrativo. No ejecutar contra producción hasta validar datos comerciales y credenciales con OCA.
