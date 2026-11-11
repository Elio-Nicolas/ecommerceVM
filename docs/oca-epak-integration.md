# Integración OCA e-Pak — diseño y plan de implementación

## Estado

Preparación técnica. La integración todavía NO está habilitada ni debe ofrecerse en checkout hasta contar con alta comercial, usuario e-Pak y datos de la operativa asignada a ecommerceVM.

La tienda vende desde Villa Mercedes, San Luis. El método actual de Envíopack no se debe reutilizar como si fuera compatible con OCA: son contratos, autenticación, cotización, admisión y seguimiento distintos.

## Lo que confirma la documentación oficial

Documentación oficial: https://developers.oca.com.ar/epak.html  
Servicio de QA: https://integraciones.ocadev.com.ar/epak_tracking_test/Oep_TrackEPak.asmx  
Servicio de producción: https://webservice.oca.com.ar/ePak_tracking/Oep_TrackEPak.asmx

- Los Web Services e-Pak responden en XML y publican el contrato WSDL agregando `?wsdl` a la URL del servicio.
- Cotización: `Tarifar_Envio_Corporativo`. Requiere CUIT registrado en OCA, número de operativa, peso total en kg, volumen total, CP de origen, CP de destino, cantidad de paquetes y valor declarado.
- Alta de envío/orden de admisión: `IngresoORMultiplesRetiros_v2` (o la variante que OCA habilite), con usuario e-Pak, contraseña, XML de retiro/entrega/paquetes y confirmación.
- Sucursales: consultar los centros habilitados por código postal y servicios antes de ofrecer retiro/entrega en sucursal.
- Etiquetas: `GetPdfDeEtiquetasPorOrdenOrNumeroEnvio` para PDF A4 o la variante para etiquetadora.
- Seguimiento: consultar operaciones de tracking y estados de la pieza.
- OCA publica endpoints de QA separados de producción. La validación inicial debe hacerse en QA cuando OCA habilite los datos correspondientes.

## Datos que debe confirmar OCA

No inventar ni hardcodear estos valores:

- Usuario e-Pak y contraseña.
- CUIT registrado en OCA, con formato requerido por el servicio.
- Operativa/s habilitadas (por ejemplo, puerta a puerta o sucursal, según contrato).
- Código postal y modalidad de despacho de origen aceptados para Villa Mercedes.
- Si la cuenta permite admisión en sucursal sin retiro domiciliario y qué sucursal/centro corresponde.
- URL/entorno de QA y habilitación de producción.
- Reglas comerciales: tarifas, seguro/valor declarado, límites de peso/volumen, frecuencia de liquidación y costos adicionales.

Las credenciales se cargarán únicamente en variables seguras del backend o en configuración administrativa cifrada. Nunca en React, repositorio, logs ni conversaciones.

## Estado actual de ecommerceVM que hay que desacoplar

La integración actual está acoplada a Envíopack en estos puntos:

- `ShippingOrigin.enviopackAddressId`.
- `ShippingSettings.enviopackEnabled` y credenciales cifradas específicas.
- Campos `Order.enviopack*` y el modelo `EnviopackWebhookEvent`.
- Cotización de checkout en `api/src/routes/shipping.routes.ts`.
- Alta, actualización de estado y descarga de etiquetas en `api/src/routes/admin-enviopack.routes.ts` y `api/src/services/enviopack-shipments.ts`.
- Configuración administrativa en `api/src/routes/admin-shipping-settings.routes.ts` y `api/src/services/shipping-settings.ts`.
- Opción de entrega y presentación de cotizaciones en `src/CheckoutPage.tsx`.
- Reglas de estado y edición de logística en `api/src/routes/admin-orders.routes.ts`.

No borrar campos históricos Envíopack ni reutilizarlos para guardar identificadores OCA. Los pedidos existentes deben seguir pudiendo consultarse e imprimirse.

## Diseño objetivo

Separar el concepto de envío del proveedor:

1. **Métodos de entrega:** retiro, entrega local y envío por transportista.
2. **Proveedor:** OCA como proveedor activo inicial; el modelo no debe asumir que todos los transportistas usan el mismo flujo.
3. **Cotización:** guardar proveedor, servicio/operativa, precio, plazo informado y vencimiento; validar que la cotización corresponda al carrito y destino.
4. **Admisión:** crear una sola orden por pedido, con bloqueo/idempotencia para impedir duplicados ante doble clic, timeout o reintento.
5. **Bultos reales:** conservar la declaración de 1 a 20 bultos físicos al preparar el pedido; no confundir dimensiones estimadas de checkout con el embalaje final.
6. **Etiqueta:** recuperar PDF del proveedor, validar que sea PDF y archivarlo para reimpresión.
7. **Seguimiento:** persistir identificador de orden, número de envío/guía, estado y eventos; avanzar el pedido a Enviado únicamente con una confirmación válida del proveedor.
8. **Errores y reintentos:** distinguir error definitivo de resultado incierto. Si se pierde la respuesta después de crear una admisión, consultar OCA antes de reintentar para no generar dos envíos.
9. **Seguridad:** credenciales exclusivamente backend, cifradas en reposo; sanitizar respuestas y no registrar secretos ni XML con datos personales.

## Orden de implementación

### Fase 1 — configuración y cotización
- Agregar configuración OCA cifrada y estado de conexión.
- Consultar sucursales/servicios por CP cuando corresponda.
- Implementar cliente HTTP/SOAP/XML contra el WSDL oficial.
- Implementar cotización con peso, volumen, cantidad de paquetes, CP origen/destino, valor declarado, CUIT y operativa.
- Validar respuestas XML, errores funcionales y timeout.
- Mantener la opción OCA deshabilitada hasta que la configuración sea válida.

### Fase 2 — admisión y etiqueta
- Construir XML de admisión según el contrato vigente y la modalidad habilitada por OCA.
- Persistir identificadores de forma idempotente antes de permitir reintentos.
- Recuperar y validar PDF de etiquetas.
- Guardar etiqueta y permitir descarga/reimpresión desde administración.

### Fase 3 — tracking y estados
- Consultar tracking por número de envío.
- Sincronizar estados sin retroceder pedidos terminales.
- Registrar historial y errores de sincronización.
- Habilitar despacho automático solo con el estado de OCA que confirme la admisión/procesamiento según el contrato de la cuenta.

### Fase 4 — retiro y producción
- Probar flujo completo en QA con destinos, bultos y sucursales reales de prueba.
- Confirmar la modalidad de despacho desde Villa Mercedes.
- Activar producción solo después de una prueba integral aprobada.

## Criterios para cerrar

- Checkout cotiza con OCA y conserva la cotización vinculada al pedido.
- No hay creación duplicada ante reintentos.
- Administración puede crear admisión, descargar/reimprimir etiqueta y consultar tracking.
- El pedido no se marca Enviado antes de la confirmación válida de OCA.
- Retiro y entrega local siguen funcionando independientemente.
- Los pedidos históricos Envíopack no pierden datos ni etiquetas.
- Build de API y frontend, generación Prisma y pruebas de integración pasan.
- Migración revisada y aplicada en el entorno correspondiente antes de activar la funcionalidad.

## Decisión pendiente

No se debe codificar a ciegas el XML de admisión ni activar cotizaciones hasta recibir de OCA la operativa, el tipo de cuenta y el acceso e-Pak. La documentación pública confirma las operaciones, pero no determina qué modalidad comercial se habilitará a esta tienda.


## Inventario técnico ampliado y plan de migración

### API y persistencia actuales

La inspección del código confirma estas dependencias concretas:

| Área | Implementación actual | Cambio previsto |
|---|---|---|
| Origen | `ShippingOrigin.enviopackAddressId` | Mantener el dato histórico; sumar configuración de origen OCA solo si el contrato exige un identificador distinto del CP |
| Credenciales | `ShippingSettings.enviopackApiKeyEncrypted` / `enviopackSecretKeyEncrypted` | Incorporar usuario, contraseña, CUIT y operativa OCA cifrados; no reutilizar campos Envíopack |
| Checkout | `POST /api/v1/shipping/quotes` | Seleccionar proveedor activo en backend; el cliente no decide qué proveedor invocar |
| Cotización | `ShippingQuote.options` JSON | Persistir proveedor y servicio en cada opción; validar fingerprint, vencimiento y destino al crear pedido |
| Pedido | `deliveryMethod`, `shippingCarrier`, `trackingCode`, `shippingCostOptions` | Mantener los campos comunes y agregar relación de envío normalizada, sin escribir IDs OCA en columnas Envíopack |
| Admisión | `POST /api/v1/admin/enviopack/orders/:id/create` | Crear endpoint de transportista con validación de pedido PREPARING y bloqueo transaccional |
| Etiqueta | `Order.enviopackLabelPdf` | Almacenar etiqueta del envío en entidad propia o storage privado, preservando el PDF histórico |
| Tracking | `EnviopackWebhookEvent` + sincronización | Incorporar eventos por proveedor y consulta OCA; no asumir que OCA ofrece el mismo webhook |
| Configuración | `/api/v1/admin/shipping-settings` | Mostrar configuración OCA y estado de conexión sin exponer secretos |

### Modelo de datos recomendado

No conviene seguir agregando columnas específicas a `Order` cada vez que cambia el transportista. La migración de OCA debería incorporar entidades neutrales:

- `ShippingShipment`: una relación con `Order`, proveedor, estado interno, identificador de admisión, número de envío/guía, servicio/operativa, datos de bultos, fechas de creación/confirmación, error recuperable y etiqueta (o referencia a storage). Restricción única por pedido/proveedor para impedir duplicados.
- `ShippingShipmentEvent`: proveedor, identificador externo del evento, tipo, estado recibido, payload sanitizado, fecha de recepción/procesamiento, intentos y último error. Índices por envío/estado/fecha y unicidad del identificador externo cuando OCA lo provea.
- `ShippingSettings`: flags de proveedor y credenciales OCA cifradas separadas de Envíopack. La clave de cifrado debe seguir siendo exclusivamente backend.
- `ShippingQuote`: agregar proveedor y código de servicio/operativa como campos consultables; el JSON conserva el detalle comercial completo de la opción.

La relación debe ser opcional para los pedidos históricos. No crear registros retroactivos ficticios ni alterar el tracking o las etiquetas existentes de Envíopack. Si más adelante se decide retirar Envíopack, sus columnas y eventos se conservan al menos durante la ventana de retención acordada y hasta verificar que no hay consultas ni descargas que dependan de ellos.

### Reglas de negocio que no se deben romper

- `PICKUP` y `LOCAL_DELIVERY` siguen operando sin credenciales de transportista.
- Solo los pedidos con modalidad de envío y estado `PREPARING` pueden iniciar una admisión.
- Una respuesta de timeout después de enviar la solicitud no habilita un segundo alta ciega: primero se consulta por referencia/orden en OCA.
- El pedido solo pasa a `SHIPPED` con confirmación de admisión/estado documentada por OCA; tener un número de orden no alcanza.
- El costo cobrado al comprador y el costo real liquidado al comercio son importes distintos. No reemplazar el precio de checkout por el costo del vendedor.
- Las dimensiones estimadas de checkout no sustituyen la declaración de bultos físicos que realiza administración al preparar.
- Una etiqueta se descarga como PDF, se valida por tipo/contenido/tamaño y se conserva para reimpresión; no se genera una etiqueta propia simulando la del correo.
- Las consultas de sucursales y cobertura deben distinguir CP de destino, centro de imposición y modalidad realmente habilitada por la cuenta.

### Orden concreto para el próximo cambio de código

1. Crear el modelo neutral de envío y la migración aditiva, sin eliminar ni renombrar columnas históricas.
2. Introducir contratos internos `quote`, `createAdmission`, `getLabel` y `getTracking`, con tipos independientes de Envíopack/OCA.
3. Adaptar primero las operaciones actuales de Envíopack al contrato neutral para comprobar que el desacoplamiento no cambia el comportamiento existente.
4. Agregar el adaptador OCA usando exclusivamente el WSDL y las muestras XML que correspondan al entorno y operativa entregados por OCA.
5. Migrar checkout y administración al contrato neutral, manteniendo las rutas antiguas como compatibilidad durante el despliegue.
6. Probar los dos proveedores en QA y recién entonces retirar Envíopack de las opciones nuevas de checkout.

No conviene ejecutar el paso 1 hasta terminar de revisar los consumidores de los campos de Envíopack en frontend, API, informes y tareas de sincronización. La migración debe ser aditiva, con backfill únicamente de envíos existentes que puedan identificarse sin ambigüedad.


## Avance de implementación (11/11/2026)

Se inició el desacoplamiento real sin modificar el contrato HTTP que consume el checkout:

- Se agregó `api/src/services/shipping-provider.ts` con tipos neutrales para proveedor, paquete, solicitud de cotización, opción y contrato de proveedor.
- Se agregó `api/src/services/enviopack-provider.ts` como adaptador del proveedor actual. La obtención de credenciales y la traducción de la solicitud específica de Envíopack quedaron dentro del adaptador.
- `api/src/routes/shipping.routes.ts` dejó de invocar directamente el cliente Envíopack y ahora solicita la cotización a través del adaptador. Se conservaron validaciones de carrito, stock, peso/dimensiones, fingerprint, vencimiento y formato de respuesta.

Este primer corte no cambia el checkout visible, no activa OCA y no requiere migración. Los campos y credenciales históricos de Envíopack siguen intactos.

### Siguiente bloque de trabajo

1. Llevar admisión, etiqueta y seguimiento al mismo límite de proveedor, manteniendo las rutas actuales compatibles.
2. Separar la modalidad genérica de envío de la identificación histórica `ENVIOPACK` en el dominio de pedidos, con migración aditiva y compatibilidad de lectura.
3. Adaptar configuración administrativa y checkout a un proveedor activo neutral.
4. Incorporar OCA solo cuando estén confirmados usuario, operativa, servicios habilitados y contrato QA.
