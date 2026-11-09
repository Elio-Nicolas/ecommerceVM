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

La integración con Envíopack utiliza exclusivamente el servidor. Configurá `ENVIOPACK_API_KEY` y `ENVIOPACK_SECRET_KEY` en el archivo `.env` de la API; nunca en el frontend. En Envíopack debe existir un depósito predeterminado y debe coincidir con el origen cargado en Administración > Depósitos de despacho.

Cada producto publicado que se envíe debe tener peso y dimensiones del paquete completos. El checkout cotiza a domicilio con el endpoint de precio para comprador, conserva las opciones durante 10 minutos y exige seleccionar una opción vigente antes de crear el pedido. El costo y total se calculan nuevamente en el backend; no se acepta un importe enviado por el navegador.

- POST `/api/v1/shipping/quotes` (público, limitado por IP)
- POST `/api/v1/orders` (requiere una cotización vigente y una opción seleccionada)

La integración consulta dos endpoints distintos: `/cotizar/precio/a-domicilio` para el precio que paga el comprador y `/cotizar/costo` para los costos que paga la tienda por cada transportista. Son importes diferentes y no se deben intercambiar. El checkout recibe exclusivamente el precio del comprador; los costos de transportistas quedan guardados en el pedido y visibles solo en Administración, con una diferencia estimada entre ambos. El costo definitivo puede variar al generar la etiqueta.


## Modalidades de entrega

El checkout ofrece tres modalidades:

- `PICKUP`: retiro por el domicilio del vendedor, sin cargo y sin depender del código postal del comprador.
- `LOCAL_DELIVERY`: entrega local habilitada por lista de códigos postales.
- `ENVIOPACK`: cotización a domicilio según el destino y los paquetes del carrito.

Configuración inicial mediante variables del entorno de la API:

- `PICKUP_ENABLED=true|false`
- `PICKUP_ADDRESS`: dirección que se informa para el retiro.
- `PICKUP_INSTRUCTIONS`: instrucciones de coordinación.
- `LOCAL_DELIVERY_ENABLED=true|false`
- `LOCAL_DELIVERY_POSTAL_CODES`: códigos postales separados por coma.
- `LOCAL_DELIVERY_FEE_ARS`: importe fijo cobrado al comprador.
- `LOCAL_DELIVERY_COORDINATE=true|false`: si es `true`, el costo queda pendiente de coordinación y no se suma al total inicial.
- `LOCAL_DELIVERY_INTERNAL_COST_ARS`: costo interno estimado, visible solo en administración.

El endpoint público `GET /api/v1/shipping/methods` informa las modalidades disponibles. La configuración es por entorno en esta primera iteración; todavía no se administra desde una pantalla del panel.
