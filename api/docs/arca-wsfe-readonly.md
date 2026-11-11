# ARCA WSFEv1

## Estado y alcance

La integración WSFEv1 está conectada al módulo administrativo y, en esta versión, opera exclusivamente contra homologación.

### Consultas de solo lectura

- `FEParamGetPtosVenta`: consulta puntos de venta y su estado.
- `FEParamGetTiposCbte`: consulta tipos de comprobante.
- `FEParamGetCondicionIvaReceptor`: consulta condiciones de IVA del receptor.
- `FECompUltimoAutorizado`: consulta el último número autorizado.

### Operaciones de comprobantes

- `FECAESolicitar`: emisión manual de Factura C (tipo 11), luego de la confirmación explícita del pago por parte del administrador.
- `FECompConsultar`: conciliación del comprobante exacto reservado cuando la emisión devuelve un resultado incierto.

No se emiten comprobantes automáticamente al crear o confirmar un pedido. Notas de crédito y débito no están implementadas.

## Entornos

- Homologación: `https://wswhomo.afip.gov.ar/wsfev1/service.asmx`
- Producción: `https://servicios1.afip.gov.ar/wsfev1/service.asmx`

Las rutas administrativas fijan el entorno en homologación y validan que la configuración persistida también sea HOMOLOGATION. No se infiere el entorno desde `NODE_ENV`.

## Seguridad e idempotencia

- La emisión requiere sesión administrativa, pedido confirmado/en preparación/enviado/entregado, confirmación explícita del pago y credenciales de homologación.
- Un bloqueo transaccional por punto de venta y tipo de comprobante serializa la reserva del número.
- Una clave de solicitud UUID evita repetir una misma petición.
- Si el resultado de la emisión es incierto, el documento queda en `UNKNOWN` y bloquea nuevas emisiones hasta conciliar.
- Si ARCA confirma autorización, se conserva CAE y vencimiento. Si confirma que el comprobante no existe (error 602) o rechaza la solicitud, el intento queda en `REJECTED`; el número puede volver a utilizarse en un nuevo intento porque ARCA no lo consumió.
- La base mantiene unicidad para números de comprobante activos/autorizados, pero permite conservar múltiples intentos rechazados del mismo número.

## Validación pendiente

El CI aplica el historial completo de migraciones sobre PostgreSQL 16 limpio y valida generación de Prisma y compilación TypeScript. Eso comprueba el esquema y el build, pero no sustituye la prueba real contra ARCA: se requiere un certificado X.509 de homologación asociado a WSFE, CUIT y punto de venta configurados. La descarga del PDF requiere además los datos legales del emisor.

Los comprobantes de homologación son pruebas, no facturas fiscales válidas para entregar al comprador. La producción y cualquier emisión automática quedan fuera del alcance actual y requieren una decisión explícita posterior.
