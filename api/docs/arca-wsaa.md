# Integración ARCA: WSAA

## Estado

El cliente WSAA está integrado al módulo administrativo de ARCA y obtiene tickets de acceso para el servicio `wsfe`. La autenticación se utiliza en consultas WSFEv1, emisión manual de Factura C de homologación y conciliación de comprobantes.

## Configuración del entorno

La API admite estas variables:

- `ARCA_CUIT`: CUIT emisor, exactamente 11 dígitos.
- `ARCA_CERTIFICATE_PATH`: ruta al certificado X.509 PEM.
- `ARCA_PRIVATE_KEY_PATH`: ruta a la clave privada PEM correspondiente.
- `ARCA_OPENSSL_PATH`: ejecutable OpenSSL; por defecto `openssl`.

Los archivos deben permanecer fuera del repositorio, con permisos restringidos y disponibles solo para el proceso de la API. Nunca subirlos a Git, adjuntarlos a tickets ni compartirlos por chat.

## Homologación

1. Habilitar WSASS desde ARCA con clave fiscal.
2. Generar el par de claves y la solicitud de certificado para homologación.
3. Obtener el certificado de homologación y asociarlo al servicio de negocio WSFE.
4. Instalar certificado y clave privada en el entorno seguro de la API.
5. Configurar las variables anteriores y probar la obtención del ticket desde Administración > Configuración > ARCA.

La autenticación de homologación usa el endpoint WSAA de testing. La aplicación mantiene el ticket en memoria, lo reutiliza mientras sea válido y coordina las solicitudes concurrentes. Ante errores permanentes de autenticación no insiste automáticamente; los errores transitorios aplican una pausa antes de reintentar.

## Consideraciones de seguridad

- La clave privada nunca se envía a ARCA; solo se utiliza localmente para firmar el TRA CMS.
- El ticket es específico del servicio solicitado y tiene vencimiento.
- No registrar token, firma CMS, clave privada ni contenido de autenticación.
- La aplicación fuerza homologación en sus rutas administrativas. La existencia de endpoints productivos en el cliente técnico no habilita su uso desde la aplicación.
- No habilitar producción ni emisión automática. La puesta en producción requiere certificado productivo, punto de venta habilitado, revisión fiscal/legal y aprobación explícita.
