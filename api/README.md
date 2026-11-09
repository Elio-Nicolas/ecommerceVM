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

La cotización inicial devuelve servicios configurados por Envíopack (por ejemplo estándar/prioritario). El endpoint documentado de precio a domicilio no garantiza devolver el nombre de cada correo; no se muestra un transportista específico si Envíopack no lo informa.
