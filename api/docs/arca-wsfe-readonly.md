# ARCA WSFEv1: consultas de solo lectura

## Alcance

El cliente está implementado en `src/services/arca-wsfe-readonly.ts` y reutiliza el ticket de acceso de `src/services/arca-wsaa.ts`.

Operaciones habilitadas en esta etapa:

- `FEParamGetPtosVenta`: consulta puntos de venta y su estado.
- `FEParamGetTiposCbte`: consulta tipos de comprobante.
- `FEParamGetCondicionIvaReceptor`: consulta condiciones de IVA del receptor; permite filtrar por clase A, ALEY, B, C o 49.
- `FECompUltimoAutorizado`: consulta el último número autorizado para un punto de venta y tipo de comprobante.

No se implementan ni exponen `FECAESolicitar`, notas de crédito/débito ni ninguna operación que autorice comprobantes. Este módulo no crea facturas ni modifica pedidos o documentos fiscales.

## Entornos

- Homologación: `https://wswhomo.afip.gov.ar/wsfev1/service.asmx`
- Producción: `https://servicios1.afip.gov.ar/wsfev1/service.asmx`

El entorno se recibe explícitamente en cada función y debe coincidir con el entorno usado para obtener el ticket WSAA. No se infiere desde `NODE_ENV`.

## Funciones

- `getArcaPointsOfSale(environment)`
- `getArcaVoucherTypes(environment)`
- `getArcaIvaReceiverConditions(environment, voucherClass?)`
- `getArcaLastAuthorizedVoucher(environment, pointOfSale, voucherType)`

El filtro opcional `voucherClass` acepta únicamente los valores documentados por WSFEv1 v4.1: `A`, `ALEY`, `B`, `C` y `49`.

Las funciones validan parámetros locales, aplican timeout a la llamada SOAP y convierten errores SOAP/WSFE en excepciones sin registrar token, firma ni contenido de autenticación.

## Validación pendiente

El CI valida generación de Prisma y compilación TypeScript. La consulta real de punta a punta requiere un certificado X.509 de homologación habilitado para WSFE y configurado de forma segura en el entorno de la API. No se deben copiar certificados ni claves privadas al repositorio ni compartirlos por chat.

La habilitación de producción y cualquier operación emisora quedan fuera de esta etapa y requieren una decisión explícita posterior.
