import type { Vec2 } from './types'
import { dist } from './geometry'

export type DimField = 'length' | 'width' | 'height' | 'radius'

export type DraftKind = 'line' | 'rect' | 'circle'

export const DIM_FIELDS_BY_KIND: Record<DraftKind, DimField[]> = {
  line: ['length'],
  rect: ['width', 'height'],
  circle: ['radius'],
}

export function dimFieldLabel(field: DimField, units: string): string {
  switch (field) {
    case 'length':
      return `Length (${units})`
    case 'width':
      return `Width (${units})`
    case 'height':
      return `Height (${units})`
    case 'radius':
      return `Radius (${units})`
  }
}

export function parseDimValue(raw: string): number | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  const n = Number.parseFloat(trimmed)
  return Number.isFinite(n) && n > 0 ? n : null
}

export function parseScaleRatio(raw: string): number | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  const n = Number.parseFloat(trimmed)
  return Number.isFinite(n) && Math.abs(n) > 1e-12 ? n : null
}

export function parseRotationAngle(raw: string): number | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  const n = Number.parseFloat(trimmed)
  return Number.isFinite(n) ? n : null
}

export function parseSignedDistance(raw: string): number | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  const n = Number.parseFloat(trimmed)
  return Number.isFinite(n) && Math.abs(n) > 0 ? n : null
}

export function parseFilletRadius(
  raw: string,
  min: number,
  max: number,
): number | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  const n = Number.parseFloat(trimmed)
  if (!Number.isFinite(n) || n < min || n > max) return null
  return n
}

export function getLineEnd(start: Vec2, cursor: Vec2, length?: number): Vec2 {
  if (length == null) return cursor
  const dx = cursor.x - start.x
  const dy = cursor.y - start.y
  const d = Math.hypot(dx, dy)
  if (d < 1e-9) return { x: start.x + length, y: start.y }
  return { x: start.x + (dx / d) * length, y: start.y + (dy / d) * length }
}

export function getRectEnd(start: Vec2, cursor: Vec2, width?: number, height?: number): Vec2 {
  const signX = cursor.x >= start.x ? 1 : -1
  const signY = cursor.y >= start.y ? 1 : -1
  return {
    x: width != null ? start.x + signX * width : cursor.x,
    y: height != null ? start.y + signY * height : cursor.y,
  }
}

export function getCircleEdge(center: Vec2, cursor: Vec2, radius?: number): Vec2 {
  const r = radius ?? dist(center, cursor)
  if (r < 1e-9) return { x: center.x + 1, y: center.y }
  const dx = cursor.x - center.x
  const dy = cursor.y - center.y
  const d = Math.hypot(dx, dy) || 1
  return { x: center.x + (dx / d) * r, y: center.y + (dy / d) * r }
}

export type LockedDims = {
  length?: number
  width?: number
  height?: number
  radius?: number
}

export function previewEndFromDraft(
  kind: DraftKind,
  anchor: Vec2,
  cursor: Vec2,
  locked: LockedDims,
): Vec2 {
  switch (kind) {
    case 'line':
      return getLineEnd(anchor, cursor, locked.length)
    case 'rect':
      return getRectEnd(anchor, cursor, locked.width, locked.height)
    case 'circle':
      return getCircleEdge(anchor, cursor, locked.radius)
  }
}
