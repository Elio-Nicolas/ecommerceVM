# Tu TiendaVM

Tienda online independiente orientada al público general de Argentina. La marca comercial es Tu TiendaVM; IORed participa como desarrollador/proveedor tecnológico, no como marca de la tienda.

## Estado del proyecto

La aplicación cuenta con storefront, API persistente, administración, gestión de pedidos, modalidades de entrega y una integración fiscal ARCA limitada a homologación.

### Storefront
- Catálogo responsive conectado a PostgreSQL mediante la API.
- Categorías, búsqueda, ordenamiento y fichas de producto.
- Carrito persistido en el navegador.
- Checkout con cotización nacional OCA cuando la cuenta está configurada, además de retiro y entrega local.
- Mercado Pago está integrado mediante Orders API, pero requiere credenciales y configuración de Webhook para habilitarse. Registrar un pedido no significa que esté cobrado.

### Administración
- Acceso protegido para administradores; no existe registro público.
- Alta, edición y archivo de productos; gestión de categorías e imágenes.
- Gestión de pedidos, estados, historial y stock reservado.
- Configuración de modalidades de entrega, orígenes de despacho y credenciales logísticas. La cuenta OCA se puede configurar de forma segura, pero la integración operativa aún no está habilitada.
- Registro y seguimiento de pagos Mercado Pago, con confirmación basada en Webhook firmado.
- Integración ARCA para consultas, emisión manual de Factura C de homologación, conciliación y PDF de prueba.

### Integraciones y límites actuales
- **Logística:** OCA es el único proveedor nacional. El cotizador y la configuración segura están preparados; la tarifa debe validarse con una respuesta real de la cuenta. Admisión, etiquetas y seguimiento requieren número de cuenta, centro de costo y modalidad confirmados. Los envíos antiguos se conservan como registros históricos neutrales.
- **ARCA:** exclusivamente homologación. Requiere certificado X.509 de pruebas asociado a WSFE, CUIT y punto de venta habilitados. Los comprobantes de homologación no son facturas fiscales válidas para entregar a compradores.
- **Pagos:** integración de código con Mercado Pago Checkout Pro mediante Orders API, persistencia de intentos, idempotencia, Webhook firmado y confirmación automática solo cuando la API verifica estado e importe. Requiere credenciales de prueba/producción y configurar el evento Order (Mercado Pago) en el panel del proveedor; no está activa sin esas variables.
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
npm run db:seed:admin # solo si necesitás crear el administrador inicial
npm run dev
```

La API queda en `http://localhost:7381`. El health check es `http://localhost:7381/api/v1/health`.

El repositorio incluye el historial de migraciones. En una base nueva se usa `prisma:deploy`; no ejecutes `prisma migrate dev --name init` ni `db push` para reconstruir el esquema. `db:seed:admin` crea el administrador inicial solo si todavía no existe y no modifica el catálogo ni sobrescribe contraseñas existentes. `db:seed` es un seed de demostración: además de sincronizar el administrador, agrega diez productos ficticios. Usalo únicamente en una base descartable/local; no lo ejecutes en el entorno comercial.

### 3. Frontend

En otra terminal, desde la raíz:

```powershell
npm install
npm run dev
```

Abrí `http://localhost:5287`. Para usar una API en otra dirección, configurá `VITE_API_URL` en el entorno de Vite.

## Datos de demostración

`npm run db:seed` crea diez productos de ejemplo y sus categorías, además de sincronizar el administrador configurado por variables de entorno. Ejecutalo solo en una base local descartable para desarrollo. No lo uses en el entorno comercial ni para cargar el catálogo real.

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
- `/api/v1/admin/arca`

Los detalles operativos de ARCA están en [api/docs/arca-wsaa.md](api/docs/arca-wsaa.md) y [api/docs/arca-wsfe-readonly.md](api/docs/arca-wsfe-readonly.md). La documentación de logística y configuración está en [api/README.md](api/README.md).

## Seguridad y preparación comercial

- Las credenciales del Compose son exclusivamente para desarrollo local.
- No subir archivos `.env`, certificados, claves privadas ni tokens.
- Las credenciales logísticas se cifran en la API. Configurá `SHIPPING_ENCRYPTION_KEY` (mínimo 32 caracteres) antes de guardar credenciales reales; los valores heredados siguen siendo legibles con `JWT_SECRET` hasta completar su rotación.
- No habilitar producción fiscal ni emitir comprobantes reales hasta completar homologación, revisión fiscal/legal y aprobación explícita.
- Antes de vender: reemplazar el catálogo demostrativo, verificar precios y stock, probar logística real, definir medios de pago y publicar políticas de privacidad, cambios, devoluciones, garantías y atención al cliente.
