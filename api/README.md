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

La integración con Envíopack utiliza exclusivamente el servidor. Las credenciales se administran desde Administración > Configuración de envíos, se cifran antes de guardarse en PostgreSQL y nunca se envían al navegador. La clave de cifrado se deriva de `JWT_SECRET`; por eso, no cambies ese secreto sin planificar la recodificación de las credenciales almacenadas.

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
