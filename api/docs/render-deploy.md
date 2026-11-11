# Despliegue de la API en Render

## Blueprint

El archivo \`render.yaml\` de la raíz define una Web Service Node en Render:

- Root directory: \`api\`
- Build: instala dependencias, genera Prisma Client y compila TypeScript.
- Pre-deploy: ejecuta \`prisma migrate deploy\` antes de poner la nueva versión en servicio.
- Health check: \`/api/v1/health\`, que comprueba también la conexión PostgreSQL.
- Región: Ohio.
- Plan: Starter. Se usa un plan pago porque Render reserva \`preDeployCommand\` para servicios pagos; no cambiar a Free sin rediseñar el paso de migraciones.

## Crear el servicio

1. Entrá a Render y elegí **New > Blueprint**.
2. Conectá el repositorio \`Elio-Nicolas/ecommerceVM\`.
3. Elegí la rama que contiene este \`render.yaml\` y confirmá el Blueprint. Revisá el plan y el costo mostrado por Render antes de crear el servicio.
4. Render va a pedir los valores marcados como \`sync: false\`. Cargalos directamente en Render, nunca en Git ni en el chat:
   - \`DATABASE_URL\`: connection string PostgreSQL de Supabase (producción), con SSL habilitado según la cadena entregada por Supabase.
   - \`CORS_ORIGIN\`: origen HTTPS exacto del frontend Vercel, sin barra final. No usar comodines.
   - \`SUPABASE_URL\` y \`SUPABASE_SERVICE_ROLE_KEY\`: credenciales del proyecto y bucket privado \`product-images\`.
   - \`ADMIN_EMAIL\` y \`ADMIN_PASSWORD\`: cuenta administrativa inicial; contraseña única de al menos 12 caracteres.
   - \`PICKUP_ADDRESS\` y \`PICKUP_INSTRUCTIONS\`: dirección y condiciones reales de retiro. No dejar el valor de ejemplo.
5. Confirmá la creación y esperá el deploy. El health check debe responder \`status: ok\` y \`database: connected\`.
6. En Render > Shell ejecutá una sola vez \`npm run db:seed:admin\`. Este comando crea/actualiza solo el administrador y no agrega productos demostrativos. No ejecutar \`npm run db:seed\`.
7. Copiá la URL pública \`https://tu-tiendavm-api.onrender.com\` que Render asigne. Luego se configura como \`VITE_API_URL\` en Vercel (con el prefijo \`/api/v1\` solo si el frontend actual lo requiere; verificar el helper de API antes de guardar).

## Variables que NO deben configurarse todavía

Mercado Pago se activa recién cuando estén disponibles el Access Token y el secreto de firma del webhook de la aplicación correcta. No inventar credenciales ni pegar tokens en GitHub. Se configurarán como \`MP_ACCESS_TOKEN\`, \`MP_WEBHOOK_SECRET\`, \`PUBLIC_APP_URL\` y \`PUBLIC_API_URL\` después de verificar ambos dominios HTTPS.

OCA no se activa todavía: faltan credenciales comerciales y pruebas QA. La entrega local permanece desactivada en el Blueprint hasta configurar zona, tarifa y condiciones reales desde Administración. El retiro queda habilitado, pero solo debe publicarse después de ingresar la dirección real.

## Migraciones

Render ejecuta \`npm run prisma:deploy\` en \`preDeployCommand\` antes de cada despliegue. No ejecutar \`prisma migrate dev\`, \`db push\` ni el seed general contra producción.
