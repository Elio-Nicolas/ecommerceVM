# Integración OCA e-Pak — diseño y plan de implementación

## Estado

Preparación técnica. La integración todavía NO está habilitada ni debe ofrecerse en checkout hasta contar con alta comercial, usuario e-Pak y datos de la operativa asignada a ecommerceVM.

La tienda vende desde Villa Mercedes, San Luis. El método actual de Envíopack no se debe reutilizar como si fuera compatible con OCA: son contratos, autenticación, cotización, admisión y seguimiento distintos.

## Lo que confirma la documentación oficial

Documentación: https://developers.oca.com.ar/epak.html

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
