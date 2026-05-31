import type { CadEntity, Units, Vec2 } from './types'
import { dist, rectFromAB } from './geometry'

/** Screen-space gap between geometry and dimension labels. */
export const DIMENSION_MARGIN_PX = 50

function marginWorld(zoom: number): number {
  return DIMENSION_MARGIN_PX / zoom
}

export function formatLength(value: number, units: Units): string {
  return `${value.toFixed(2)} ${units}`
}

export type DimensionOrientation = 'horizontal' | 'vertical'

export type DimensionLabel = {
  text: string
  at: Vec2
  orientation?: DimensionOrientation
}

/** Pick horizontal vs vertical text from line angle (whichever axis is closer). */
export function snapDimensionOrientation(angleRad: number): DimensionOrientation {
  let a = angleRad % Math.PI
  if (a < 0) a += Math.PI
  const distHorizontal = Math.min(a, Math.PI - a)
  const distVertical = Math.abs(a - Math.PI / 2)
  return distHorizontal <= distVertical ? 'horizontal' : 'vertical'
}

export function getEntityDimensions(e: CadEntity, units: Units, zoom: number): DimensionLabel[] {
  const offset = marginWorld(zoom)
  switch (e.type) {
    case 'line': {
      const len = dist(e.a, e.b)
      const mid = { x: (e.a.x + e.b.x) / 2, y: (e.a.y + e.b.y) / 2 }
      const angle = Math.atan2(e.b.y - e.a.y, e.b.x - e.a.x)
      const at = {
        x: mid.x - Math.sin(angle) * offset,
        y: mid.y + Math.cos(angle) * offset,
      }
      return [{ text: formatLength(len, units), at, orientation: snapDimensionOrientation(angle) }]
    }
    case 'rect': {
      const r = rectFromAB(e.a, e.b)
      const w = r.w
      const h = r.h
      const cx = (r.x1 + r.x2) / 2
      const cy = (r.y1 + r.y2) / 2
      return [
        { text: formatLength(w, units), at: { x: cx, y: r.y1 - offset }, orientation: 'horizontal' },
        { text: formatLength(h, units), at: { x: r.x2 + offset, y: cy }, orientation: 'vertical' },
      ]
    }
    case 'circle': {
      const d = e.r * 2
      return [
        {
          text: `Ø ${formatLength(d, units)}`,
          at: { x: e.c.x + e.r * 0.6, y: e.c.y - e.r - offset },
        },
      ]
    }
    default:
      return []
  }
}
