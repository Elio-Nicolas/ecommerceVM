import PDFDocument from 'pdfkit'
import QRCode from 'qrcode'
import { env } from '../config/env'

export interface ArcaInvoicePdfInput {
  cuit: string
  pointOfSale: number
  voucherType: number
  voucherNumber: number
  issueDate: Date
  receiverDocumentType: number | null
  receiverDocumentNumber: string | null
  receiverVatConditionId: number | null
  receiverName: string
  receiverAddress: string | null
  currencyCode: string
  currencyRate: number
  totalAmountArs: number
  cae: string
  caeExpiresAt: Date
  items: unknown
}

function formatArs(value: number): string {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 2 }).format(value)
}

function dateOnly(value: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires', year: 'numeric', month: '2-digit', day: '2-digit' }).format(value)
}

export function assertArcaIssuerProfileConfigured(): void {
  if (!env.ARCA_ISSUER_NAME || !env.ARCA_ISSUER_ADDRESS || !env.ARCA_ISSUER_VAT_CONDITION) {
    throw new Error('Configurá ARCA_ISSUER_NAME, ARCA_ISSUER_ADDRESS y ARCA_ISSUER_VAT_CONDITION en el .env de la API para generar comprobantes fiscales.')
  }
}

export async function generateArcaInvoicePdf(input: ArcaInvoicePdfInput): Promise<Buffer> {
  assertArcaIssuerProfileConfigured()
  const issueDate = dateOnly(input.issueDate)
  const qrPayload: Record<string, string | number> = {
    ver: 1,
    fecha: issueDate,
    cuit: Number(input.cuit),
    ptoVta: input.pointOfSale,
    tipoCmp: input.voucherType,
    nroCmp: input.voucherNumber,
    importe: input.totalAmountArs,
    moneda: input.currencyCode,
    ctz: input.currencyRate,
    tipoCodAut: 'E',
    codAut: Number(input.cae),
  }
  if (input.receiverDocumentType !== null && input.receiverDocumentNumber) {
    const receiverNumber = Number(input.receiverDocumentNumber)
    if (!Number.isSafeInteger(receiverNumber)) throw new Error('El documento del receptor supera el rango numérico seguro para el QR de ARCA.')
    qrPayload.tipoDocRec = input.receiverDocumentType
    qrPayload.nroDocRec = receiverNumber
  }
  const encoded = Buffer.from(JSON.stringify(qrPayload), 'utf8').toString('base64')
  const qrUrl = `https://www.arca.gob.ar/fe/qr/?p=${encoded}`
  const qrPng = await QRCode.toBuffer(qrUrl, { type: 'png', errorCorrectionLevel: 'M', margin: 1, width: 220 })
  const chunks: Buffer[] = []
  const pdf = new PDFDocument({ size: 'A4', margins: { top: 42, bottom: 42, left: 46, right: 46 }, info: { Title: `Factura C ${input.pointOfSale}-${input.voucherNumber}`, Author: env.ARCA_ISSUER_NAME } })
  pdf.on('data', (chunk: Buffer) => chunks.push(chunk))
  const completed = new Promise<Buffer>((resolve, reject) => {
    pdf.on('end', () => resolve(Buffer.concat(chunks)))
    pdf.on('error', reject)
  })

  const right = 550
  pdf.font('Helvetica-Bold').fontSize(20).fillColor('#172b3a').text(env.ARCA_ISSUER_NAME!, 46, 42, { width: 330 })
  pdf.font('Helvetica').fontSize(9).fillColor('#52606c').text(env.ARCA_ISSUER_ADDRESS!, 46, 70, { width: 330 })
  pdf.text(`CUIT: ${input.cuit}`, 46, 85)
  pdf.text(`Condición frente al IVA: ${env.ARCA_ISSUER_VAT_CONDITION}`, 46, 99, { width: 330 })
  pdf.rect(392, 40, 156, 94).lineWidth(1).stroke('#9aa7b2')
  pdf.font('Helvetica-Bold').fontSize(24).fillColor('#172b3a').text('C', 392, 48, { width: 156, align: 'center' })
  pdf.fontSize(9).text('COD. 011 · FACTURA', 392, 82, { width: 156, align: 'center' })
  pdf.font('Helvetica').fontSize(8).text('Comprobante electrónico', 392, 99, { width: 156, align: 'center' })
  pdf.moveTo(46, 148).lineTo(right, 148).lineWidth(1).stroke('#cbd3da')

  pdf.font('Helvetica-Bold').fontSize(11).fillColor('#172b3a').text('FACTURA C', 46, 164)
  pdf.font('Helvetica').fontSize(9).fillColor('#52606c')
  pdf.text(`Punto de venta: ${String(input.pointOfSale).padStart(5, '0')}`, 46, 184)
  pdf.text(`Comprobante N°: ${String(input.voucherNumber).padStart(8, '0')}`, 46, 198)
  pdf.text(`Fecha de emisión: ${issueDate.split('-').reverse().join('/')}`, 46, 212)
  pdf.text(`Documento receptor: ${input.receiverDocumentNumber ?? 'No informado'}`, 310, 184)
  pdf.text(`Tipo de documento: ${input.receiverDocumentType ?? 'No informado'}`, 310, 198)
  pdf.text(`Condición IVA receptor (ID): ${input.receiverVatConditionId ?? 'No informada'}`, 310, 212)
  pdf.text(`Receptor: ${input.receiverName}`, 310, 226, { width: 238 })
  if (input.receiverAddress) pdf.text(`Domicilio: ${input.receiverAddress}`, 310, 240, { width: 238 })

  const tableY = 278
  pdf.rect(46, tableY, 502, 24).fill('#edf1f4')
  pdf.font('Helvetica-Bold').fontSize(8).fillColor('#273440')
  pdf.text('DESCRIPCIÓN', 54, tableY + 8)
  pdf.text('CANT.', 350, tableY + 8, { width: 42, align: 'right' })
  pdf.text('PRECIO UNIT.', 398, tableY + 8, { width: 70, align: 'right' })
  pdf.text('IMPORTE', 474, tableY + 8, { width: 66, align: 'right' })
  let y = tableY + 34
  const items = Array.isArray(input.items) ? input.items as Record<string, unknown>[] : []
  for (const item of items) {
    const name = typeof item.productName === 'string' ? item.productName : 'Artículo'
    const quantity = Number(item.quantity) || 0
    const unit = Number(item.unitPriceArs) || 0
    const line = Number(item.lineTotalArs) || quantity * unit
    pdf.font('Helvetica').fontSize(8).fillColor('#273440')
    pdf.text(name, 54, y, { width: 285 })
    pdf.text(String(quantity), 350, y, { width: 42, align: 'right' })
    pdf.text(formatArs(unit), 398, y, { width: 70, align: 'right' })
    pdf.text(formatArs(line), 474, y, { width: 66, align: 'right' })
    y += Math.max(22, pdf.heightOfString(name, { width: 285 }) + 8)
    if (y > 650) { pdf.addPage(); y = 50 }
  }
  const itemTotal = items.reduce((sum, item) => sum + (Number(item.lineTotalArs) || 0), 0)
  const shipping = Math.max(0, input.totalAmountArs - itemTotal)
  if (shipping > 0) {
    pdf.text('Envío', 54, y, { width: 285 })
    pdf.text('1', 350, y, { width: 42, align: 'right' })
    pdf.text(formatArs(shipping), 398, y, { width: 70, align: 'right' })
    pdf.text(formatArs(shipping), 474, y, { width: 66, align: 'right' })
    y += 24
  }
  y = Math.max(y + 18, 390)
  pdf.moveTo(330, y).lineTo(548, y).lineWidth(1).stroke('#cbd3da')
  pdf.font('Helvetica-Bold').fontSize(12).fillColor('#172b3a').text('TOTAL', 340, y + 12)
  pdf.text(formatArs(input.totalAmountArs), 430, y + 12, { width: 108, align: 'right' })
  pdf.font('Helvetica').fontSize(8).fillColor('#52606c').text('Moneda: PES · Cotización: 1', 340, y + 34)
  const qrY = Math.min(Math.max(y + 62, 500), 630)
  pdf.image(qrPng, 46, qrY, { width: 112, height: 112 })
  pdf.font('Helvetica-Bold').fontSize(9).fillColor('#172b3a').text('CAE', 176, qrY + 8)
  pdf.font('Helvetica').fontSize(10).text(input.cae, 176, qrY + 24)
  pdf.fontSize(8).text(`Vencimiento CAE: ${dateOnly(input.caeExpiresAt).split('-').reverse().join('/')}`, 176, qrY + 44)
  pdf.text('Código QR de verificación ARCA', 176, qrY + 64)
  pdf.fontSize(7).fillColor('#7a8792').text('Comprobante autorizado electrónicamente. El QR permite verificar los datos ante ARCA.', 176, qrY + 80, { width: 350 })
  pdf.end()
  return completed
}
