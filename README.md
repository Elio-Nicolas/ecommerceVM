# ecommerceVM

Tienda online independiente orientada al público general de Argentina. La marca comercial todavía es provisoria; IORed participa como desarrollador/proveedor tecnológico, no como marca de la tienda.

## Estado actual

**Etapa 1 — Storefront:** implementada.
- Catálogo responsive con categorías, búsqueda y ordenamiento.
- Fichas rápidas de producto y carrito en memoria.
- Precios y productos demostrativos; no representan stock ni ofertas reales.
- Checkout y pagos deshabilitados.

**Etapa 2 — Backend y persistencia:** base inicial implementada en la rama `feature/backend-foundation`.
- API REST con Node.js, Express y TypeScript.
- PostgreSQL 16 aislado para desarrollo local.
- Prisma ORM y modelos iniciales de categorías y productos.
- Endpoints de salud, categorías y catálogo con búsqueda, filtros y paginación.
- El frontend consume categorías y productos desde la API. Los diez productos iniciales se cargan mediante el seed de Prisma.

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

## Frontend

Desde la raíz del repositorio:

```powershell
npm install
npm run dev
```

Vite está configurado para usar el puerto 5287 y fallar si está ocupado.

## Backend y base de datos

1. Iniciar PostgreSQL desde la raíz:

```powershell
docker compose up -d ecommercevm-postgres
```

2. Preparar el backend:

```powershell
cd api
Copy-Item .env.example .env
npm install
npm run prisma:generate
npm run prisma:migrate -- --name init
npm run db:seed
npm run dev
```

La API queda en `http://localhost:7381`. La base de datos escucha en el puerto 5547.

## Endpoints iniciales

- `GET /api/v1`
- `GET /api/v1/health`
- `GET /api/v1/categories`
- `GET /api/v1/products`
- `GET /api/v1/products/:slug`

El catálogo admite búsqueda por texto, filtro por categoría, orden y paginación.

## Estructura

```
src/                  # storefront React
api/
  prisma/schema.prisma
  src/
    config/
    lib/
    middleware/
    routes/
    app.ts
    server.ts
docker-compose.yml    # PostgreSQL local
```

## Próximas etapas

1. Conectar el frontend con la API y trasladar los productos demostrativos a PostgreSQL.
2. Definir identidad comercial y validar proveedores, catálogo real, precios, stock y logística nacional.
3. Incorporar administración protegida de productos e inventario (API inicial implementada; interfaz administrativa pendiente).
4. Implementar checkout y pagos reales; verificar pagos siempre desde el backend.
5. Incorporar políticas comerciales, privacidad, cambios, devoluciones, garantías y atención.

## Seguridad

Las credenciales del Compose son exclusivamente para desarrollo local. No reutilizarlas en producción. No subir archivos `.env` ni secretos al repositorio.
