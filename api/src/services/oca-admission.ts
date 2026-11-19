import { getStoredOcaCredentials } from './shipping-settings'

import { OcaAdmissionError, parseOcaAdmissionResponse, type OcaAdmissionResult } from './oca-admission-response'
export { OcaAdmissionError, parseOcaAdmissionResponse }

const endpoints = {
  QA: 'https://integraciones.ocadev.com.ar/epak_tracking_test/Oep_TrackEPak.asmx',
  PRODUCTION: 'https://webservice.oca.com.ar/ePak_tracking/Oep_TrackEPak.asmx',
} as const

/**
 * Creates one OCA admission using the published e-Pak HTTP POST contract.
 * Immediate confirmation is deliberately opt-in; false leaves the order in
 * the e-Pak cart for an operator to confirm there.
 */
export async function createOcaAdmission(input: {
  xmlData: string
  confirmImmediately?: boolean
  requiredEnvironment?: keyof typeof endpoints
}): Promise<OcaAdmissionResult> {
  const credentials = await getStoredOcaCredentials()
  if (!credentials) throw new OcaAdmissionError('OCA todavía no está configurado.', 503)
  if (input.requiredEnvironment && credentials.environment !== input.requiredEnvironment) {
    throw new OcaAdmissionError('El ambiente OCA cambió o no coincide con el ambiente autorizado para esta operación.', 409)
  }
  if (!input.xmlData.trim() || input.xmlData.length > 100_000) {
    throw new OcaAdmissionError('Los datos XML de admisión están vacíos o superan el tamaño permitido.', 400)
  }

  const url = endpoints[credentials.environment] + '/IngresoORMultiplesRetiros_v2'
  const body = new URLSearchParams({
    usr: credentials.username,
    psw: credentials.password,
    xml_Datos: input.xmlData,
    ConfirmarRetiro: input.confirmImmediately === true ? 'true' : 'false',
    ArchivoCliente: '',
    ArchivoProceso: '',
    compatMode: '',
  })

  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8' },
      body,
      signal: AbortSignal.timeout(25000),
    })
  } catch {
    throw new OcaAdmissionError(
      'Se interrumpió la comunicación con OCA durante la admisión. El resultado puede ser incierto: consultá e-Pak antes de reintentar.',
      502,
      true,
    )
  }
  if (!response.ok) {
    throw new OcaAdmissionError(
      'OCA respondió HTTP ' + response.status + ' al registrar el envío. Verificá e-Pak antes de reintentar.',
      502,
      true,
    )
  }
  let responseXml: string
  try {
    responseXml = await response.text()
  } catch {
    throw new OcaAdmissionError(
      'Se interrumpió la lectura de la respuesta de OCA. El resultado puede ser incierto: consultá e-Pak antes de reintentar.',
      502,
      true,
    )
  }
  return parseOcaAdmissionResponse(responseXml)
}
