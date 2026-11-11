import assert from 'node:assert/strict'
import test from 'node:test'
import { parseCatalogCsv } from '../../src/catalog-csv'

test('parsea CSV con coma y respeta comas dentro de campos entrecomillados', () => {
  const rows = parseCatalogCsv('sku,nombre,descripcion,precio_ars,stock,categoria\nSKU-1,Producto,"Descripción, con detalle",1500,3,Accesorios\n')
  assert.equal(rows.length, 1)
  assert.equal(rows[0].descripcion, 'Descripción, con detalle')
  assert.equal(rows[0].precio_ars, '1500')
})

test('parsea CSV con punto y coma y campos entrecomillados', () => {
  const rows = parseCatalogCsv('sku;nombre;descripcion;precio_ars;stock;categoria\nSKU-2;Producto;"Descripción; con detalle";2500;4;Hogar\n')
  assert.equal(rows.length, 1)
  assert.equal(rows[0].descripcion, 'Descripción; con detalle')
  assert.equal(rows[0].categoria, 'Hogar')
})

test('tolera BOM UTF-8 y finales de línea CRLF', () => {
  const rows = parseCatalogCsv('\uFEFFsku;nombre\nSKU-3;Producto\r\n')
  assert.equal(rows[0].sku, 'SKU-3')
})

test('rechaza archivos vacíos, encabezados repetidos, columnas inconsistentes y comillas sin cerrar', () => {
  assert.throws(() => parseCatalogCsv('sku,nombre\n'), /no contiene productos/)
  assert.throws(() => parseCatalogCsv('sku,sku\n1,2\n'), /encabezados repetidos/)
  assert.throws(() => parseCatalogCsv('sku,nombre\n1\n'), /columnas/)
  assert.throws(() => parseCatalogCsv('sku,nombre\n1,"Producto\n'), /comillas sin cerrar/)
})
