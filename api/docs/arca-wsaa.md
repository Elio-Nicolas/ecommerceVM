# Integración ARCA: WSAA

## Estado

El cliente WSAA está implementado en `src/services/arca-wsaa.ts`, pero todavía no está conectado a rutas HTTP ni al proceso de emisión. No genera comprobantes ni cambia el estado fiscal de los pedidos.

## Configuración del entorno

La API admite estas variables opcionales:

- `ARCA_CUIT`: CUIT emisora, exactamente 11 dígitos.
- `ARCA_CERTIFICATE_PATH`: ruta al certificado X.509 en PEM.
- `ARCA_PRIVATE_KEY_PATH`: ruta a la clave privada PEM correspondiente.
- `ARCA_OPENSSL_PATH`: ejecutable OpenSSL; por defecto `openssl`.

Los archivos de certificado y clave deben permanecer fuera del repositorio, con permisos restringidos y disponibles solo para el proceso de la API. Nunca subirlos a Git, adjuntarlos a tickets ni compartirlos por chat.

## Homologación

1. Habilitar WSASS desde ARCA con clave fiscal.
2. Generar un par de claves y solicitud de certificado para el entorno de homologación.
3. Obtener el certificado de homologación y asociarlo al servicio de negocio WSFE.
4. Instalar certificado y clave privada en el entorno seguro de la API.
5. Configurar las variables anteriores y probar la obtención del ticket WSAA para el servicio `wsfe`.

La autenticación de homologación usa el endpoint WSAA de testing. Producción usa un endpoint distinto y requiere certificado de producción y autorización correspondiente. El entorno debe elegirse explícitamente desde la configuración fiscal; nunca inferirse por el entorno de Node.

## Consideraciones

- El ticket WSAA es específico del servicio solicitado y tiene vencimiento; el cliente lo conserva en memoria y lo renueva antes de vencer.
- La clave privada nunca se envía a ARCA; solo se usa localmente para firmar el TRA CMS.
- La integración real requiere validar el certificado y la autorización de acceso en WSASS.
- No habilitar producción ni emisión automática hasta completar homologación, validación funcional y revisión explícita.
