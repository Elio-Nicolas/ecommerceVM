# ecommerceVM API

API REST para el catálogo y la administración de productos.

Puertos: API 7381, PostgreSQL 5547, frontend 5287.

## Configuración

Copiar .env.example a .env y completar JWT_SECRET con un secreto aleatorio de al menos 32 caracteres, ADMIN_EMAIL y ADMIN_PASSWORD (mínimo 12 caracteres). No subir .env al repositorio.

Desde esta carpeta:
```powershell
npm install
npm run prisma:generate
npm run prisma:migrate -- --name admin_auth
npm run db:seed
npm run dev
```

La migración agrega la tabla AdminUser. El seed crea o actualiza el administrador inicial si las dos variables ADMIN están definidas.

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

La integración con Envíopack utiliza exclusivamente el servidor. Las credenciales se administran desde Administración > Configuración de envíos, se cifran antes de guardarse en PostgreSQL y nunca se envían al navegador. Si ya existía configuración en variables de entorno de una instalación anterior, se importa automáticamente una sola vez al crear el registro `ShippingSettings`; desde entonces, los valores operativos se administran en el panel. La clave de cifrado se deriva de `JWT_SECRET`; por eso, no cambies ese secreto sin planificar la recodificación de las credenciales almacenadas.

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
