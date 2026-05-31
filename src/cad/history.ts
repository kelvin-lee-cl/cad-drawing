import type { CadDoc } from './types'

export const MAX_UNDO_STEPS = 50

export function cloneDoc(doc: CadDoc): CadDoc {
  return structuredClone(doc)
}
