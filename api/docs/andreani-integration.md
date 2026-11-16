# Integración Andreani — ecommerceVM

## Alcance de esta primera etapa

Andreani se incorpora como segundo proveedor nacional, independiente de OCA. No se elimina ni se modifica la configuración OCA, el retiro por domicilio del vendedor ni la entrega local.

Esta etapa implementa:

- Configuración independiente de Andreani (QA / Producción).
- Almacenamiento cifrado de usuario, contraseña, código de cliente y contrato.
- Prueba administrativa de autenticación contra Andreani.
- Cotización nacional Andreani desde el checkout.
- Persistencia de cotizaciones con el mismo fingerprint de carrito y vencimiento de 10 minutos que el flujo existente.
- Validación de cotización al crear el pedido.
- Protección para impedir marcar un pedido Andreani como despachado sin un envío Andreani procesado y con tracking.

Todavía no implementa la creación/admisión de órdenes, descarga de etiquetas ni sincronización de tracking. Esas operaciones se deben cerrar con el OpenAPI vigente y los datos/servicios concretos habilitados para la cuenta de ecommerceVM; no se deben inferir campos obligatorios ni códigos de contrato.

## Documentación y ambientes

- Portal oficial: https://developers.andreani.com/
- Portal oficial de documentación interactiva / sandbox: https://developers-sandbox.andreani.com/
- QA API base: `https://apisqa.andreani.com`
- Producción API base: `https://apis.andreani.com`

Andreani informa que ofrece APIs para cotizar, crear y seguir envíos, y que las credenciales de QA requieren ser cliente y gestionarse con el área comercial / ejecutivo de cuenta. El portal sandbox anuncia especificación OpenAPI y emulador preproductivo.

La web pública de documentación puede responder 403 al acceso automatizado. Los endpoints y estructuras de la primera etapa se contrastaron con referencias técnicas comunitarias disponibles públicamente; por eso la autenticación y la cotización deben validarse con credenciales QA y respuestas reales de la cuenta antes de habilitar compras reales. No se tomó una librería no oficial como dependencia del proyecto.

## Credenciales

Desde Administración → Configuración de envíos → Andreani:

- Entorno: QA por defecto.
- Usuario API.
- Contraseña API.
- Código de cliente.
- Contrato.

Los cuatro datos se guardan cifrados usando el servicio de cifrado logístico existente. El API administrativo nunca devuelve secretos; solo devuelve `andreaniConfigured` y el entorno. Al cambiar entre QA y Producción, se exige volver a ingresar las credenciales correspondientes al nuevo ambiente; no se reutilizan las credenciales del ambiente anterior.

No subir credenciales a Git, issues, logs ni chats. No cambiar a Producción hasta contar con credenciales productivas y completar pruebas de aceptación.

## Endpoints implementados

### Autenticación

- `POST /v2/login`
- Body: `{ "usuario": "...", "password": "..." }`
- Se espera un token en la respuesta y se cachea en memoria por hasta 23 horas para evitar depender de un vencimiento exacto de 24 horas.

La acción **Probar conexión Andreani** invoca la autenticación desde el backend. No expone el token al navegador.

### Cotización

- `GET /v1/tarifas`
- Query parameters:
  - `cpDestino`
  - `contrato`
  - `cliente`
  - `bultos[0][volumen]` (cm³)
  - `bultos[0][kilos]` (kg)

La integración utiliza el volumen y peso consolidados de todos los artículos del pedido como un único bulto. No crea un bulto por unidad. El endpoint documentado por referencias técnicas públicas no requiere autenticación; la autenticación se prueba por separado con `/v2/login`.

Para el importe al comprador se prioriza `tarifaConIva.total`; si no está presente, se usa `tarifaSinIva.total`. Esta selección debe validarse con una respuesta real de QA y el contrato comercial. El plazo estimado queda sin informar hasta contar con una respuesta/servicio que lo confirme.

### API ecommerceVM

- `GET /api/v1/shipping/methods`: agrega `andreani.enabled` y `andreani.environment`.
- `POST /api/v1/shipping/quotes`: acepta `provider: "ANDREANI"` junto con provincia, CP y artículos.
- `GET/PUT /api/v1/admin/shipping-settings`: configuración sin secretos.
- `POST /api/v1/admin/shipping-settings/andreani/test`: valida autenticación con las credenciales guardadas.

## Modelo de paquetes

Se conserva la regla de consolidación ya utilizada por la tienda: un pedido cotiza como un único bulto con peso y volumen acumulados por cantidades. El modelo de producto requiere peso y las tres dimensiones; si faltan datos, no se genera una tarifa estimada.

## Pendiente para completar el ciclo logístico

1. Obtener del ejecutivo de Andreani credenciales QA, código de cliente, contrato/s habilitados y servicios permitidos.
2. Consultar el OpenAPI de Transporte y Distribución correspondiente a la cuenta para confirmar el payload de alta de orden y campos obligatorios del remitente/destinatario.
3. Confirmar cómo se despacha desde Villa Mercedes: admisión en sucursal o retiro, dirección/origen comercial y modalidad habilitada.
4. Implementar alta idempotente del pre-envío y persistir número/agrupador devueltos por Andreani.
5. Implementar etiqueta PDF (y validar formato/tamaño de impresión).
6. Implementar consulta de estado y trazas (tracking), mapeando estados externos sin saltar controles internos.
7. Probar flujo completo en QA: cotización → pedido → pre-envío → etiqueta → admisión → tracking → entregado.
8. Activar checkout Andreani solo tras pruebas exitosas. Producción requiere aprobación explícita y credenciales productivas.

## Migración y despliegue

La migración `20261116120000_add_andreani_shipping_settings` agrega columnas cifradas y ambiente a `ShippingSettings`.

En despliegues API:

```bash
npx prisma migrate deploy
npx prisma generate
npm run build
```

El pipeline de Render también ejecuta migraciones y generación Prisma según la configuración documentada en el proyecto. Confirmar el despliegue y la generación del cliente antes de probar el panel.

## Seguridad y límites

- Credenciales solo en backend y cifradas con `SHIPPING_ENCRYPTION_KEY` (o compatibilidad heredada con `JWT_SECRET`).
- No se incluyen secretos ni credenciales de ejemplo reales.
- No se envían órdenes reales desde esta etapa.
- Producción no se selecciona automáticamente.
- Si la tarifa no devuelve un importe reconocible, se falla la cotización; no se inventan precios.
- La admisión y el cambio a `SHIPPED` quedan bloqueados hasta tener confirmación del proveedor y tracking persistido.
