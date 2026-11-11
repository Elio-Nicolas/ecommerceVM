export type CsvRow = Record<string, string>

export function parseCatalogCsv(source: string): CsvRow[] {
  const text = source.replace(/^\uFEFF/, '')
  const records: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  let delimiter = ','

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (char === '"' && text[index + 1] === '"') {
      index += 1
      continue
    }
    if (char === '"') quoted = !quoted
    else if (!quoted && (char === ',' || char === ';')) {
      if (char === ';') delimiter = ';'
      else if (delimiter !== ';') delimiter = ','
    }
    if (!quoted && (char === '\n' || char === '\r')) break
  }

  row = []
  cell = ''
  quoted = false
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        cell += '"'
        index += 1
      } else if (char === '"') {
        quoted = false
      } else {
        cell += char
      }
    } else if (char === '"' && cell.length === 0) {
      quoted = true
    } else if (char === delimiter) {
      row.push(cell.trim())
      cell = ''
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[index + 1] === '\n') index += 1
      row.push(cell.trim())
      if (row.some((value) => value.length > 0)) records.push(row)
      row = []
      cell = ''
    } else {
      cell += char
    }
  }

  if (quoted) throw new Error('El CSV contiene un campo entre comillas sin cerrar.')
  row.push(cell.trim())
  if (row.some((value) => value.length > 0)) records.push(row)
  if (records.length < 2) throw new Error('El archivo no contiene productos para importar.')

  const headers = records[0].map((value) => value.trim().toLocaleLowerCase('es'))
  if (new Set(headers).size !== headers.length) throw new Error('El CSV contiene encabezados repetidos.')
  return records.slice(1).map((values, index) => {
    if (values.length !== headers.length) {
      throw new Error('La fila ' + (index + 2) + ' tiene ' + values.length + ' columnas y se esperaban ' + headers.length + '.')
    }
    return Object.fromEntries(headers.map((header, column) => [header, values[column] ?? '']))
  })
}

export const catalogCsvTemplate = 'sku;nombre;descripcion;precio_ars;stock;categoria;estado;imagen_url;precio_anterior_ars;peso_gramos;largo_cm;ancho_cm;alto_cm;destacado;etiqueta;especificaciones\n'
