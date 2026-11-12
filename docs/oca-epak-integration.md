# OCA e-Pak — Tu TiendaVM

OCA e-Pak reemplaza al proveedor logístico anterior. El checkout conserva el flujo de cotización previa, selección del servicio y costo en el total. Retiro y entrega local siguen independientes.

Documentación oficial: https://developers.oca.com.ar/epak.html

- Cotización QA: https://integraciones.ocadev.com.ar/epak_tracking_test/Oep_TrackEPak.asmx/Tarifar_Envio_Corporativo
- Cotización producción: https://webservice.oca.com.ar/ePak_tracking/Oep_TrackEPak.asmx/Tarifar_Envio_Corporativo
- Sucursales por CP: GetCentrosImposicionConServiciosByCP
- Centros de costo: GetCentroCostoPorOperativa
- Admisión: IngresoORMultiplesRetiros_v2
- Etiquetas PDF: GetPdfDeEtiquetasPorOrdenOrNumeroEnvio

Los Web Services responden XML y publican WSDL agregando ?wsdl.

## Datos pendientes de OCA

Usuario y contraseña e-Pak, CUIT, operativa, número de cuenta, centro de costo, modalidad de despacho desde Villa Mercedes, franja horaria y acceso QA. No se inventan ni se guardan en frontend.

La cotización requiere CUIT con guiones, operativa, peso kg, volumen m³, CP origen/destino, cantidad de paquetes y valor declarado. La admisión requiere además usuario, contraseña y XML con origen, destinatario y bultos, junto con número de cuenta y centro de costo.

## Estado

- Configuración OCA con credenciales cifradas en backend.
- Checkout y pedidos identifican OCA como proveedor nacional.
- Cotizador contra Tarifar_Envio_Corporativo; el mapeo de respuesta debe validarse con una respuesta real de la cuenta.
- Retiro y entrega local no dependen de OCA.
- Pedidos históricos migran a ShippingShipment como LEGACY_CARRIER, preservando IDs, tracking, bultos y PDF.
- Admisión, etiquetas y tracking OCA quedan pendientes de confirmar datos comerciales y probar con la cuenta.

QA es el entorno inicial. No marcar pedidos como enviados sin confirmación válida de OCA. El costo al comprador y el costo real del comercio son importes distintos.
