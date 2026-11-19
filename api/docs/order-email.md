# Comprobantes de compra por correo

La API envía un correo transaccional al crear un pedido cuando el comprador informó un email.

El mensaje incluye:
- Código único del pedido.
- Productos, cantidades, subtotal, envío, recargo y total (o importe a confirmar).
- Domicilio/modalidad de entrega.
- Estado del pago expresado sin dar por acreditados pagos pendientes.
- Enlace a `/arrepentimiento` e instrucciones para usar el código junto con el correo de compra.

## Configuración en producción

Configurar en el servicio API de Render:

- `RESEND_API_KEY`: API key de Resend con permiso de envío.
- `ORDER_EMAIL_FROM`: remitente con formato `Tu TiendaVM <pedidos@dominio-verificado>`.

El dominio del remitente debe estar agregado y verificado en Resend. No usar una dirección del dominio propio hasta completar esa verificación. `PUBLIC_APP_URL` determina el enlace del botón de arrepentimiento; en producción debe apuntar a la tienda pública.

El correo se envía después de que la transacción del pedido se confirma. Un fallo del proveedor se registra en los logs y no revierte ni bloquea la compra. Se usa una clave de idempotencia por pedido para evitar duplicados ante reintentos del proveedor.

El email del comprador pasa a ser obligatorio en el checkout para que cada pedido tenga un destinatario para el comprobante.
