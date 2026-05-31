import { newId } from './id'
import type { CadDoc, CadEntity } from './types'

export const CAD_PROJECT_VERSION = 1

export function createEmptyDoc(): CadDoc {
  const layerId = newId('layer')
  return {
    units: 'mm',
    worldUnitsLabel: 'mm',
    layers: [{ id: layerId, name: 'Layer 1', color: '#63b3ff', visible: true }],
    activeLayerId: layerId,
    entities: [],
  }
}

export type CadProjectFile = {
  version: typeof CAD_PROJECT_VERSION
  doc: CadDoc
}

function stripSelection(entity: CadEntity): CadEntity {
  const { selected: _selected, ...rest } = entity
  return rest as CadEntity
}

export function serializeDoc(doc: CadDoc): CadProjectFile {
  return {
    version: CAD_PROJECT_VERSION,
    doc: {
      ...doc,
      entities: doc.entities.map(stripSelection),
    },
  }
}

export function deserializeDoc(data: unknown): CadDoc {
  if (!data || typeof data !== 'object') {
    throw new Error('Invalid project data')
  }

  const payload = data as Partial<CadProjectFile> & Partial<CadDoc>

  if (payload.version === CAD_PROJECT_VERSION && payload.doc) {
    return structuredClone(payload.doc)
  }

  if (payload.units && payload.layers && payload.entities) {
    return structuredClone(payload as CadDoc)
  }

  throw new Error('Unrecognized project format')
}

export function downloadDocJson(doc: CadDoc, filename = 'drawing.json'): void {
  const json = JSON.stringify(serializeDoc(doc), null, 2)
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}
