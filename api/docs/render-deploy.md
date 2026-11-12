# Despliegue de la API en Render

## Blueprint gratuito

El archivo `render.yaml` de la raíz define una Web Service Node en Render:

- Plan: Free (sin costo de instancia).
- Root directory: `api`.
- Build: instala dependencias, genera Prisma Client, aplica migraciones con `prisma migrate deploy` y compila TypeScript.
- Inicialización: `initialDeployHook` ejecuta `npm run db:seed:admin` una sola vez después del primer deploy exitoso.
- Health check: `/api/v1/health`, que comprueba también la conexión PostgreSQL.
- Región: Ohio.

**Limitaciones del plan Free:** Render suspende la API después de 15 minutos sin tráfico; el primer acceso posterior puede tardar alrededor de un minuto. No incluye Shell/SSH ni tareas one-off. Es una opción temporal para probar y comenzar con bajo costo, no la opción recomendada para una tienda con disponibilidad crítica. Render también puede suspender servicios si se exceden los límites incluidos de ancho de banda o minutos de build.

## Crear el servicio

1. Entrá a Render y elegí **New > Blueprint**.
2. Conectá el repositorio `Elio-Nicolas/ecommerceVM`.
3. Elegí la rama que contiene este `render.yaml`.
4. Revisá que Render muestre el plan **Free** y costo de instancia **US$0**. No confirmes si aparece Starter u otro plan pago.
5. Render va a pedir los valores marcados como `sync: false`. Cargalos directamente en Render, nunca en Git ni en el chat:
   - `DATABASE_URL`: connection string PostgreSQL de Supabase (producción), con SSL habilitado según la cadena entregada por Supabase.
   - `CORS_ORIGIN`: origen HTTPS exacto del frontend Vercel, sin barra final. No usar comodines.
   - `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY`: credenciales del proyecto y bucket privado `product-images`.
   - `ADMIN_EMAIL` y `ADMIN_PASSWORD`: cuenta administrativa inicial; contraseña única de al menos 12 caracteres.
   - `PICKUP_ADDRESS` y `PICKUP_INSTRUCTIONS`: dirección y condiciones reales de retiro. No dejar valores de ejemplo.
6. Los secretos `JWT_SECRET` y `SHIPPING_ENCRYPTION_KEY` se generan automáticamente desde el Blueprint.
7. Confirmá la creación y esperá el deploy. El health check debe responder `status: ok` y `database: connected`. El hook inicial configura el administrador sin agregar productos de demostración.
8. Copiá la URL pública que Render asigne. Luego configurá `VITE_API_URL` en Vercel con esa URL exacta, sin `/api/v1` y sin barra final; el frontend agrega `/api/v1` automáticamente.

## Migraciones y administrador

- `npm run prisma:deploy` corre durante el build. No ejecutar `prisma migrate dev` ni `db push` contra producción.
- `npm run db:seed:admin` corre mediante `initialDeployHook` una sola vez tras el primer deploy exitoso. No ejecutar `npm run db:seed`: agrega productos demostrativos.
- Si en el futuro se necesita volver a crear el administrador en Free, no hay Shell/SSH ni tareas one-off. Se deberá usar un procedimiento administrativo controlado antes de necesitarlo; no cambiar la contraseña en variables esperando que se actualice automáticamente.

## Variables que NO deben configurarse todavía

Mercado Pago se activa recién cuando estén disponibles el Access Token y el secreto de firma del webhook de la aplicación correcta. No inventar credenciales ni pegar tokens en GitHub. Se configurarán como `MP_ACCESS_TOKEN`, `MP_WEBHOOK_SECRET`, `PUBLIC_APP_URL` y `PUBLIC_API_URL` después de verificar ambos dominios HTTPS.

OCA no se activa todavía: faltan credenciales comerciales y pruebas QA. La entrega local permanece desactivada hasta configurar zona, tarifa y condiciones reales desde Administración. El retiro queda habilitado, pero solo debe publicarse después de ingresar la dirección real.

## Conectar Vercel

El frontend lee `VITE_API_URL` como URL base y agrega `/api/v1` automáticamente. Cuando Render entregue la URL pública, configurá `VITE_API_URL` en Vercel con esa URL exacta, sin `/api/v1` y sin barra final. Aplicá el cambio en Production y redeployá el frontend.
