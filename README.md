# ecommerceVM

Tienda online independiente orientada al público general de Argentina. La marca comercial es provisoria; IORed participa como desarrollador/proveedor tecnológico, no como marca de la tienda.

## Estado del proyecto

La aplicación cuenta con storefront, API persistente, administración, gestión de pedidos, modalidades de entrega y una integración fiscal ARCA limitada a homologación.

### Storefront
- Catálogo responsive conectado a PostgreSQL mediante la API.
- Categorías, búsqueda, ordenamiento y fichas de producto.
- Carrito persistido en el navegador.
- Checkout para registrar pedidos con retiro, entrega local o cotización de Envíopack, según la configuración administrativa.
- Los pagos en línea todavía no están habilitados. Registrar un pedido no significa que esté cobrado.

### Administración
- Acceso protegido para administradores; no existe registro público.
- Alta, edición y archivo de productos; gestión de categorías e imágenes.
- Gestión de pedidos, estados, historial y stock reservado.
- Configuración de modalidades de entrega, orígenes de despacho y credenciales de Envíopack.
- Integración ARCA para consultas, emisión manual de Factura C de homologación, conciliación y PDF de prueba.

### Integraciones y límites actuales
- **Envíopack:** cotización y gestión logística desde el backend. Requiere credenciales y origen de despacho configurados. La generación de etiquetas y el seguimiento dependen de la cuenta y de las pruebas con el proveedor.
- **ARCA:** exclusivamente homologación. Requiere certificado X.509 de pruebas asociado a WSFE, CUIT y punto de venta habilitados. Los comprobantes de homologación no son facturas fiscales válidas para entregar a compradores.
- **Pagos:** no hay pasarela integrada ni confirmación automática de cobros.
- **Catálogo:** el seed incluye diez productos demostrativos. Deben reemplazarse o revisarse antes de vender; sus precios, imágenes y disponibilidad no representan una oferta comercial real.

## Puertos locales

| Servicio | Puerto |
|---|---:|
| Frontend React + Vite | 5287 |
| API Node + Express | 7381 |
| PostgreSQL | 5547 |

## Requisitos

- Node.js 20.19+ o 22.12+
- npm
- Docker Desktop con Docker Compose
- PostgreSQL 16 (el entorno local lo inicia mediante Docker Compose)

## Puesta en marcha

### 1. Base de datos

Desde la raíz del repositorio:

```powershell
docker compose up -d ecommercevm-postgres
```

### 2. API

Desde la raíz:

```powershell
cd api
Copy-Item .env.example .env
```

Completá `.env` con un `JWT_SECRET` aleatorio de al menos 32 caracteres y credenciales locales de administrador seguras. No compartas ni subas ese archivo.

Luego, desde `api`:

```powershell
npm install
npm run prisma:deploy
npm run prisma:generate
npm run db:seed
npm run dev
```

La API queda en `http://localhost:7381`. El health check es `http://localhost:7381/api/v1/health`.

El repositorio incluye el historial de migraciones. En una base nueva se usa `prisma:deploy`; no ejecutes `prisma migrate dev --name init` ni `db push` para reconstruir el esquema. El seed crea datos iniciales faltantes y configura el administrador si se definieron `ADMIN_EMAIL` y `ADMIN_PASSWORD`; no debe utilizarse como mecanismo para actualizar el catálogo comercial.

### 3. Frontend

En otra terminal, desde la raíz:

```powershell
npm install
npm run dev
```

Abrí `http://localhost:5287`. Para usar una API en otra dirección, configurá `VITE_API_URL` en el entorno de Vite.

## Comandos habituales

Desde `api`:

| Comando | Uso |
|---|---|
| `npm run dev` | Iniciar API en desarrollo |
| `npm run build` | Compilar API TypeScript |
| `npm run prisma:deploy` | Aplicar migraciones pendientes |
| `npm run prisma:generate` | Regenerar Prisma Client |
| `npm run db:seed` | Crear datos iniciales faltantes y sincronizar el administrador |

Desde la raíz:

| Comando | Uso |
|---|---|
| `npm run dev` | Iniciar frontend |
| `npm run build` | Compilar frontend |

## Endpoints principales

Públicos:
- `GET /api/v1/health`
- `GET /api/v1/categories`
- `GET /api/v1/products`
- `GET /api/v1/products/:slug`
- `GET /api/v1/shipping/methods`
- `POST /api/v1/shipping/quotes`
- `POST /api/v1/orders`

Administrativos (requieren Bearer token):
- `POST /api/v1/auth/login`
- `GET /api/v1/auth/me`
- `/api/v1/admin/products`
- `/api/v1/admin/categories`
- `/api/v1/admin/orders`
- `/api/v1/admin/shipping-settings`
- `/api/v1/admin/shipping-origins`
- `/api/v1/admin/enviopack`
- `/api/v1/admin/arca`

Los detalles operativos de ARCA están en [api/docs/arca-wsaa.md](api/docs/arca-wsaa.md) y [api/docs/arca-wsfe-readonly.md](api/docs/arca-wsfe-readonly.md). La documentación de logística y configuración está en [api/README.md](api/README.md).

## Seguridad y preparación comercial

- Las credenciales del Compose son exclusivamente para desarrollo local.
- No subir archivos `.env`, certificados, claves privadas ni tokens.
- Las credenciales de Envíopack se cifran en la API; su cifrado depende de `JWT_SECRET`. Rotar ese secreto requiere planificar la recodificación de las credenciales guardadas.
- No habilitar producción fiscal ni emitir comprobantes reales hasta completar homologación, revisión fiscal/legal y aprobación explícita.
- Antes de vender: reemplazar el catálogo demostrativo, verificar precios y stock, probar logística real, definir medios de pago y publicar políticas de privacidad, cambios, devoluciones, garantías y atención al cliente.
