import assert from 'node:assert/strict'
import testCase from 'node:test'
import { parseOcaCostCenters, OcaMetadataError } from '../src/services/oca-metadata'

const response = \`<?xml version="1.0"?><NewDataSet><Table><NroCentroCosto>123</NroCentroCosto><Solicitante>Casa Central</Solicitante><CalleRetiro>San Martín</CalleRetiro><NumeroRetiro>123</NumeroRetiro><LocalidadRetiro>Villa Mercedes</LocalidadRetiro><codigopostal>5730</codigopostal></Table><Table><NroCentroCosto>456</NroCentroCosto><Solicitante>Depósito</Solicitante><LocalidadRetiro>San Luis</LocalidadRetiro><CodigoPostal>5700</CodigoPostal></Table></NewDataSet>\`

testCase('parsea centros de costo devueltos por OCA', () => {
  assert.deepEqual(parseOcaCostCenters(response), [
    { number: '123', requester: 'Casa Central', locality: 'Villa Mercedes', postalCode: '5730' },
    { number: '456', requester: 'Depósito', locality: 'San Luis', postalCode: '5700' },
  ])
})

testCase('parsea XML escapado por respuesta ASMX', () => {
  const escaped = response.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  assert.equal(parseOcaCostCenters(escaped)[0]?.number, '123')
})

testCase('rechaza SOAP Fault y estructuras desconocidas', () => {
  assert.throws(() => parseOcaCostCenters('<soap:Fault>error</soap:Fault>'), OcaMetadataError)
  assert.throws(() => parseOcaCostCenters('<Unexpected>ok</Unexpected>'), OcaMetadataError)
})


import { parseOcaAdmissionBranches } from '../src/services/oca-metadata'

const branches = \`<?xml version="1.0"?><soap:Envelope><soap:Body><GetCentrosImposicionConServiciosByCPResponse><GetCentrosImposicionConServiciosByCPResult><CentrosDeImposicion xmlns=""><Centro><IdCentroImposicion>25</IdCentroImposicion><Sigla>VM1</Sigla><Sucursal>SUCURSAL VILLA MERCEDES</Sucursal><Calle>MITRE</Calle><Numero>123</Numero><Localidad>VILLA MERCEDES</Localidad><CodigoPostal>5730</CodigoPostal><Provincia>SAN LUIS</Provincia><Servicios><Servicio><IdTipoServicio>1</IdTipoServicio><ServicioDesc>Admisión de paquetes</ServicioDesc></Servicio><Servicio><IdTipoServicio>2</IdTipoServicio><ServicioDesc>Entrega de paquetes</ServicioDesc></Servicio></Servicios></Centro><Centro><IdCentroImposicion>26</IdCentroImposicion><Sigla>VM2</Sigla><Sucursal>SOLO ENTREGA</Sucursal><Servicios><Servicio><IdTipoServicio>2</IdTipoServicio><ServicioDesc>Entrega de paquetes</ServicioDesc></Servicio></Servicios></Centro></CentrosDeImposicion></GetCentrosImposicionConServiciosByCPResult></soap:Body></soap:Envelope>\`

testCase('incluye sólo sucursales con servicio de admisión', () => {
  assert.deepEqual(parseOcaAdmissionBranches(branches), [{
    id: '25',
    code: 'VM1',
    name: 'SUCURSAL VILLA MERCEDES',
    address: 'MITRE 123',
    postalCode: '5730',
    locality: 'VILLA MERCEDES',
    province: 'SAN LUIS',
    admissionEnabled: true,
  }])
})

testCase('rechaza XML de sucursales con estructura desconocida', () => {
  assert.throws(() => parseOcaAdmissionBranches('<Unexpected>ok</Unexpected>'), OcaMetadataError)
})
