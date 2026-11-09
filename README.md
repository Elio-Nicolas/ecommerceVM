# ecommerceVM

Tienda online independiente orientada al público general de Argentina. La marca comercial todavía es provisoria; IORed participa como desarrollador/proveedor tecnológico, no como marca de la tienda.

## Estado actual

**Etapa 1 — Base de storefront:** implementada en esta rama.

- Catálogo responsive con categorías, búsqueda y ordenamiento.
- Fichas rápidas de producto con descripción y características.
- Carrito funcional en memoria durante la navegación, con edición de cantidades y eliminación.
- Precios de demostración en pesos argentinos.
- Checkout y pagos todavía deshabilitados: no hay integración real ni se simula una compra.
- Productos e imágenes de muestra, editables desde `src/products.ts`.

## Stack

- React 19
- TypeScript
- Vite 6
- CSS responsive propio

## Requisitos

- Node.js 20.19+ o 22.12+
- npm

## Desarrollo local

```bash
npm install
npm run dev
```

## Validación de producción

```bash
npm run build
npm run preview
```

## Estructura

```
src/
  App.tsx       # storefront, catálogo, detalle y carrito
  products.ts   # catálogo demostrativo y formato ARS
  index.css     # sistema visual responsive
  main.tsx      # punto de entrada
```

## Próximas etapas

1. Definir identidad comercial, nombre y dominio.
2. Validar catálogo real, proveedores, precios, stock y logística nacional.
3. Diseñar backend, persistencia, administración y gestión de pedidos.
4. Integrar checkout real. Para Mercado Pago, evaluar el flujo vigente de Checkout Pro vía Orders API y verificar pagos desde backend; no confiar en el retorno del navegador como confirmación de pago.
5. Incorporar políticas comerciales, privacidad, cambios, devoluciones, garantías y atención.

## Nota sobre datos

Los productos, precios y fotografías actuales son demostrativos. No representan stock, disponibilidad ni ofertas reales.
