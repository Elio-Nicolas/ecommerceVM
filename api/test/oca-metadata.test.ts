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
