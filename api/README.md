# ecommerceVM API

API REST inicial para el catálogo de la tienda.

## Stack

- Node.js + Express 5 + TypeScript
- PostgreSQL 16
- Prisma ORM 6
- Zod para validar parámetros y configuración

## Puertos locales

- API: 7381
- PostgreSQL: 5547
- Frontend: 5287

## Preparación

Desde esta carpeta:

```powershell
Copy-Item .env.example .env
npm install
```

Desde la raíz del repositorio, iniciar PostgreSQL:

```powershell
docker compose up -d ecommercevm-postgres
```

Luego, desde `api/`:

```powershell
npm run prisma:generate
npm run prisma:migrate -- --name init
npm run dev
```

La migración crea las tablas iniciales de categorías y productos. No se cargan productos automáticamente todavía.

## Endpoints

- `GET /api/v1`: información del servicio.
- `GET /api/v1/health`: estado de API y conexión a PostgreSQL.
- `GET /api/v1/categories`: categorías.
- `GET /api/v1/products`: catálogo activo con búsqueda, categoría, orden y paginación.
- `GET /api/v1/products/:slug`: detalle de producto activo.

Ejemplos de consulta:

```
GET /api/v1/products?q=camara&sort=price-asc&page=1&limit=12
GET /api/v1/products?category=hogar-inteligente
```

## Estado

La API y el esquema de persistencia son la base de la etapa 2. El frontend todavía usa el catálogo demostrativo local; la conexión frontend-API y la carga inicial del catálogo se realizan en el siguiente bloque.
