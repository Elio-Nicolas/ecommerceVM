type DateValue = Date | string | null | undefined

type OcaRecipient = {
  firstName: string
  lastName: string
  phone?: string
  email?: string
  postalCode: string
  locality: string
  province: string
}

type OcaOrderIdentity = {
  customerName: string
  customerPhone: string
  customerEmail: string | null
  postalCode: string | null
  city: string
  province: string
}

type OcaBranch = {
  id: string
  street: string | null
  number: string | null
  postalCode: string | null
  locality: string | null
  province: string | null
} | null

export function isOcaOrderPaid(paymentReceivedAt: DateValue, attempts: { status: string; approvedAt: DateValue }[]): boolean {
  return Boolean(paymentReceivedAt) || attempts.some((attempt) => attempt.status === 'APPROVED' && Boolean(attempt.approvedAt))
}

export function normalizeOcaRecipientText(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('es')
}

export function matchesOcaRecipient(order: OcaOrderIdentity, recipient: OcaRecipient): boolean {
  const recipientName = normalizeOcaRecipientText(recipient.firstName + ' ' + recipient.lastName)
  return recipientName === normalizeOcaRecipientText(order.customerName)
    && (!recipient.phone || recipient.phone.replace(/\D/g, '') === order.customerPhone.replace(/\D/g, ''))
    && (!recipient.email || recipient.email.toLocaleLowerCase('es') === order.customerEmail?.toLocaleLowerCase('es'))
    && recipient.postalCode === order.postalCode
    && normalizeOcaRecipientText(recipient.locality) === normalizeOcaRecipientText(order.city)
    && normalizeOcaRecipientText(recipient.province) === normalizeOcaRecipientText(order.province)
}

export function isCompleteOcaOriginBranch(branch: OcaBranch, expectedId: string, expectedPostalCode: string): branch is NonNullable<OcaBranch> {
  return Boolean(branch
    && branch.id === expectedId
    && branch.street?.trim()
    && branch.number?.trim()
    && branch.postalCode === expectedPostalCode
    && branch.locality?.trim()
    && branch.province?.trim())
}

export function getOcaAdmissionDate(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)
  const values: Record<string, string> = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return values.year + values.month + values.day
}
