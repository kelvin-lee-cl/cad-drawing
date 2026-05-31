import type { CadEntity, Units, Vec2, Viewport } from './types'
import { dist, rectFromAB } from './geometry'
import { worldToScreen } from './viewport'

/** Extra canvas padding when fitting extents with dimensions visible. */
export const DIMENSION_MARGIN_PX = 50

/** Screen-space gap between geometry and dimension labels. */
export const DIMENSION_LABEL_OFFSET_PX = 14

export function formatLength(value: number, units: Units): string {
  return `${value.toFixed(2)} ${units}`
}

export type DimensionOrientation = 'horizontal' | 'vertical'

export type DimensionLabel = {
  text: string
  /** World point on or beside the measured geometry. */
  anchor: Vec2
  /** Pixel offset from anchor (+x right, +y down). */
  screenOffset: Vec2
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

function lineLabelScreenOffset(vp: Viewport, a: Vec2, b: Vec2, marginPx: number): Vec2 {
  const sa = worldToScreen(vp, a)
  const sb = worldToScreen(vp, b)
  const dx = sb.x - sa.x
  const dy = sb.y - sa.y
  const len = Math.hypot(dx, dy)
  if (len < 1e-6) return { x: 0, y: -marginPx }
  const px = -dy / len
  const py = dx / len
  return { x: px * marginPx, y: py * marginPx }
}

export function getEntityDimensions(e: CadEntity, units: Units, vp: Viewport): DimensionLabel[] {
  const gap = DIMENSION_LABEL_OFFSET_PX
  switch (e.type) {
    case 'line': {
      const len = dist(e.a, e.b)
      const mid = { x: (e.a.x + e.b.x) / 2, y: (e.a.y + e.b.y) / 2 }
      const angle = Math.atan2(e.b.y - e.a.y, e.b.x - e.a.x)
      return [
        {
          text: formatLength(len, units),
          anchor: mid,
          screenOffset: lineLabelScreenOffset(vp, e.a, e.b, gap),
          orientation: snapDimensionOrientation(angle),
        },
      ]
    }
    case 'rect': {
      const r = rectFromAB(e.a, e.b)
      const cx = (r.x1 + r.x2) / 2
      const cy = (r.y1 + r.y2) / 2
      return [
        {
          text: formatLength(r.w, units),
          anchor: { x: cx, y: r.y1 },
          screenOffset: { x: 0, y: gap },
          orientation: 'horizontal',
        },
        {
          text: formatLength(r.h, units),
          anchor: { x: r.x2, y: cy },
          screenOffset: { x: gap, y: 0 },
          orientation: 'vertical',
        },
      ]
    }
    case 'circle': {
      const d = e.r * 2
      return [
        {
          text: `Ø ${formatLength(d, units)}`,
          anchor: { x: e.c.x, y: e.c.y + e.r },
          screenOffset: { x: 0, y: -gap },
        },
      ]
    }
    default:
      return []
  }
}
