# ecommerceVM API

API REST para el catálogo y la administración de productos.

Puertos: API 7381, PostgreSQL 5547, frontend 5287.

## Configuración

Copiar .env.example a .env y completar JWT_SECRET con un secreto aleatorio de al menos 32 caracteres, ADMIN_EMAIL y ADMIN_PASSWORD (mínimo 12 caracteres). No subir .env al repositorio.

Desde esta carpeta:
```powershell
npm install
npm run prisma:deploy
npm run prisma:generate
npm run db:seed
npm run dev
```

El repositorio incluye el historial completo de migraciones, desde el esquema inicial de catálogo hasta pedidos, logística y facturación. Para una base nueva, `prisma:deploy` crea el esquema en el orden correcto; no generes otra migración `admin_auth`. El seed crea o actualiza el administrador inicial si las dos variables ADMIN están definidas.

## Endpoints públicos
- GET /api/v1
- GET /api/v1/health
- GET /api/v1/categories
- GET /api/v1/products
- GET /api/v1/products/:slug
- POST /api/v1/auth/login

## Endpoints protegidos
Enviar Authorization: Bearer <token>.
- GET /api/v1/auth/me
- GET /api/v1/admin/products
- POST /api/v1/admin/products
- PUT /api/v1/admin/products/:id
- DELETE /api/v1/admin/products/:id (archiva, no borra físicamente)

Los tokens vencen a las 8 horas. Las contraseñas se almacenan con bcrypt. No existe registro público de administradores.

## Cotización de envíos

La integración con Envíopack utiliza exclusivamente el servidor. Las credenciales se administran desde Administración > Configuración de envíos, se cifran antes de guardarse en PostgreSQL y nunca se envían al navegador. Si ya existía configuración en variables de entorno de una instalación anterior, se importa automáticamente una sola vez al crear el registro `ShippingSettings`; desde entonces, los valores operativos se administran en el panel. Las credenciales nuevas se cifran con `SHIPPING_ENCRYPTION_KEY`, una clave independiente de `JWT_SECRET` que debe persistir entre despliegues y configurarse en producción. Los valores cifrados con el mecanismo anterior siguen siendo legibles mediante compatibilidad heredada; al reemplazarlos desde el panel se guardan con el mecanismo nuevo. No cambies ni elimines `JWT_SECRET` hasta completar la rotación de credenciales heredadas.

Cada producto publicado que se envíe debe tener peso y dimensiones del paquete completos. El checkout cotiza a domicilio con el endpoint de precio para comprador, conserva las opciones durante 10 minutos y exige seleccionar una opción vigente antes de crear el pedido. El costo y total se calculan nuevamente en el backend; no se acepta un importe enviado por el navegador.

- POST `/api/v1/shipping/quotes` (público, limitado por IP)
- POST `/api/v1/orders` (Envíopack requiere una cotización vigente; retiro y entrega local usan la configuración persistida)

La integración consulta dos endpoints distintos: `/cotizar/precio/a-domicilio` para el precio que paga el comprador y `/cotizar/costo` para los costos que paga la tienda por cada transportista. Son importes diferentes y no se deben intercambiar. El checkout recibe exclusivamente el precio del comprador; los costos de transportistas quedan guardados en el pedido y visibles solo en Administración, con una diferencia estimada entre ambos. El costo definitivo puede variar al generar la etiqueta.


## Modalidades de entrega

El checkout ofrece tres modalidades:

- `PICKUP`: retiro por el domicilio del vendedor, sin cargo y sin depender del código postal del comprador.
- `LOCAL_DELIVERY`: entrega local habilitada por lista de códigos postales.
- `ENVIOPACK`: cotización a domicilio según el destino y los paquetes del carrito.

La configuración operativa se administra desde Administración > Configuración de envíos. Allí se habilitan las modalidades, se definen códigos postales, tarifas, costos internos, domicilio e instrucciones de retiro y credenciales de Envíopack. Los cambios se guardan en la tabla `ShippingSettings` y se aplican inmediatamente, sin reiniciar la API.

La ruta protegida `GET/PUT /api/v1/admin/shipping-settings` permite administrar estos valores. La ruta pública `GET /api/v1/shipping/methods` solo expone los datos necesarios para el checkout; nunca expone credenciales.


## PDF de Factura C autorizada

La descarga protegida `GET /api/v1/admin/arca/documents/:documentId/pdf` solo está disponible para comprobantes con estado `AUTHORIZED`, CAE y vencimiento confirmados. El PDF se conserva en el registro fiscal y contiene el QR conforme a la especificación oficial de ARCA.

Para generar el PDF se deben completar en el entorno de la API los datos legales del emisor:
- `ARCA_ISSUER_NAME`: nombre o razón social.
- `ARCA_ISSUER_ADDRESS`: domicilio fiscal.
- `ARCA_ISSUER_VAT_CONDITION`: condición frente al IVA.

Si falta alguno, la API no genera una representación fiscal incompleta. El QR utiliza los datos persistidos del comprobante autorizado y el verificador oficial de ARCA.


## Facturación electrónica ARCA (solo homologación)

La integración implementa autenticación WSAA, consultas WSFEv1, emisión manual de Factura C (tipo 11), conciliación de resultados inciertos y descarga del PDF con CAE y QR. La configuración de producción no está habilitada.

### Preparar el entorno

1. Gestioná en ARCA un certificado de **homologación** para el servicio WSFEv1 y su clave privada correspondiente. El certificado debe estar asociado al CUIT emisor y habilitado para el entorno de pruebas.
2. Instalá ambos archivos en el servidor de la API, fuera del repositorio y con permisos de lectura exclusivos para el usuario del proceso.
3. Configurá estas variables en el entorno de ejecución de la API:
   - `ARCA_CUIT`: CUIT emisor, solo dígitos.
   - `ARCA_CERTIFICATE_PATH`: ruta absoluta al certificado PEM.
   - `ARCA_PRIVATE_KEY_PATH`: ruta absoluta a la clave privada PEM.
   - `ARCA_OPENSSL_PATH`: opcional; ejecutable OpenSSL si no está disponible como `openssl` en PATH.
   - `ARCA_ISSUER_NAME`, `ARCA_ISSUER_ADDRESS`, `ARCA_ISSUER_VAT_CONDITION`: datos legales del emisor requeridos para construir el PDF fiscal.
4. Reiniciá la API para que lea las variables. No guardes certificados, claves privadas ni archivos `.env` en Git, ni los pegues en tickets o chats.
5. Aplicá las migraciones pendientes desde `api`:
   ```powershell
   npx prisma migrate deploy
   npx prisma generate
   ```
   La migración fiscal inicial es `20261110170000_fiscal_documents`. En instalaciones donde ya fue aplicada, no se vuelve a ejecutar. `migrate deploy` es el comando para entornos desplegados; no uses `migrate dev` en producción.
6. En Administración > Configuración > ARCA, guardá el punto de venta habilitado en homologación y activá la integración. Probá la conexión y consultá los datos de homologación.
7. En Administración > Pedidos, confirmá primero el pedido y verificá el cobro por fuera de esta integración. Completá tipo/número de documento y condición IVA del receptor según los datos y catálogos devueltos por ARCA. La emisión es una acción manual y explícita.

### Operación y controles

- La integración está limitada a homologación. No se debe cambiar el entorno ni apuntar a producción.
- El endpoint de emisión exige confirmación explícita del pago, reserva el número bajo bloqueo transaccional y usa una clave de solicitud idempotente.
- Si la respuesta de ARCA no permite conocer el resultado con certeza, el documento queda en `UNKNOWN` y bloquea nuevas emisiones para ese punto de venta. Primero se debe usar **Conciliar con ARCA**; no se debe reintentar manualmente a ciegas.
- El PDF solo se habilita cuando el comprobante figura `AUTHORIZED` y tiene CAE y vencimiento confirmados. El PDF no se genera para solicitudes rechazadas o inciertas. Si ARCA confirma que una solicitud fue rechazada o que el número no existe (error 602), el intento se conserva como `REJECTED` y el mismo número puede reutilizarse en un nuevo intento; los intentos rechazados no bloquean la unicidad de los comprobantes activos.
- Los comprobantes emitidos en homologación son comprobantes de prueba: no son facturas fiscales válidas para entregar al comprador ni registran una venta real.
- La habilitación de producción requiere un proceso separado: certificado productivo, punto de venta productivo, revisión fiscal/legal y pruebas de aceptación. Esta versión no ofrece esa activación.

### Endpoints administrativos

Todos requieren sesión administrativa (Bearer token):

- `GET/PUT /api/v1/admin/arca/settings`: consultar y guardar configuración de homologación.
- `POST /api/v1/admin/arca/settings/test`: validar autenticación WSAA.
- `GET /api/v1/admin/arca/diagnostics`: consultar puntos de venta, tipos de comprobante, condiciones IVA y último número autorizado; solo lectura.
- `POST /api/v1/admin/arca/orders/:orderId/invoice-c`: solicitar una Factura C de prueba.
- `POST /api/v1/admin/arca/documents/:documentId/reconcile`: consultar en ARCA el resultado de una emisión pendiente.
- `GET /api/v1/admin/arca/documents/:documentId/pdf`: descargar el PDF de una factura autorizada.


## Pagos online con Mercado Pago Checkout Pro (Orders API)

La integración utiliza la API moderna de Orders para Checkout Pro. El servidor crea una orden de pago por pedido con clave de idempotencia; el comprador es redirigido al checkout alojado por Mercado Pago. El sistema registra cada intento, valida el importe y la referencia externa, y solo confirma el pedido cuando consulta la orden en Mercado Pago y verifica que esté procesada y pagada por el total exacto.

### Variables de entorno

Configurar en el entorno de la API, nunca en el frontend:

- `MP_ACCESS_TOKEN`: Access Token privado de la aplicación (usar primero credenciales de prueba).
- `MP_WEBHOOK_SECRET`: firma secreta de Webhooks de la misma aplicación.
- `PUBLIC_APP_URL`: URL pública HTTPS del storefront.
- `PUBLIC_API_URL`: URL pública HTTPS de la API.

Los pagos se habilitan únicamente cuando están presentes las cuatro variables. No guardar el Access Token ni la firma secreta en Git, en el navegador ni en mensajes.

### Webhook

En Mercado Pago > Tus integraciones > aplicación > Configuración de Webhooks:

1. Configurar el entorno de prueba.
2. Usar como URL `https://TU_API/api/v1/payments/webhook`.
3. Seleccionar el evento **Order (Mercado Pago)**.
4. Guardar y copiar la firma secreta a `MP_WEBHOOK_SECRET`.

El servidor valida `x-signature` mediante HMAC-SHA256 y consulta `GET /v1/orders/:id` antes de modificar el pedido. Los parámetros de retorno del navegador nunca se consideran prueba de pago. Los pedidos con costo de entrega pendiente no pueden cobrarse hasta que el total quede definido.

### Endpoints

- `GET /api/v1/payments/config`: informa si el checkout online está habilitado.
- `POST /api/v1/payments/orders/:orderId`: crea o recupera un intento idempotente y devuelve `checkoutUrl`.
- `GET /api/v1/payments/orders/:orderId/status`: consulta el estado público del pago.
- `POST /api/v1/payments/webhook`: recibe y valida eventos Order de Mercado Pago.
- `POST /api/v1/payments/admin/orders/:orderId/attempts/:attemptId/reconcile`: permite al administrador consultar el estado actual directamente en Mercado Pago cuando un Webhook no llegó.

Los reembolsos se inician desde el panel de Mercado Pago. El Webhook sincroniza reembolsos totales y parciales; un pedido reembolsado no puede seguir preparándose y un reembolso parcial queda bloqueado para revisión manual.

La integración de código no sustituye la prueba de extremo a extremo. Antes de cobrar a compradores reales, completar pruebas con credenciales de prueba, verificar notificaciones en el panel, configurar credenciales productivas y ejecutar una prueba controlada en producción.
