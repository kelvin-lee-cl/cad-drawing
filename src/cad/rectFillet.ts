import type { RectEntity, Vec2 } from './types'
import { rectFromAB } from './geometry'

export type RectArc = { c: Vec2; r: number; startRad: number; endRad: number }
export type RectOutline = { edges: [Vec2, Vec2][]; arcs: RectArc[] }

export function effectiveRectFillet(
  bounds: { w: number; h: number },
  filletR?: number,
): number {
  if (!filletR || filletR <= 1e-9) return 0
  const max = Math.min(bounds.w, bounds.h) / 2
  return Math.min(filletR, max)
}

export function rectFilletRadiusRange(a: Vec2, b: Vec2): { min: number; max: number } | null {
  const bounds = rectFromAB(a, b)
  const max = Math.min(bounds.w, bounds.h) / 2
  if (max <= 1e-6) return null
  const min = Math.max(1e-6, Math.min(max * 0.01, max * 0.99))
  return { min, max }
}

export function rectOutline(a: Vec2, b: Vec2, filletR?: number): RectOutline {
  const bounds = rectFromAB(a, b)
  const r = effectiveRectFillet(bounds, filletR)
  const { x1, y1, x2, y2 } = bounds
  if (r <= 1e-9) {
    return {
      edges: [
        [{ x: x1, y: y1 }, { x: x2, y: y1 }],
        [{ x: x2, y: y1 }, { x: x2, y: y2 }],
        [{ x: x2, y: y2 }, { x: x1, y: y2 }],
        [{ x: x1, y: y2 }, { x: x1, y: y1 }],
      ],
      arcs: [],
    }
  }
  return {
    edges: [
      [{ x: x1 + r, y: y1 }, { x: x2 - r, y: y1 }],
      [{ x: x2, y: y1 + r }, { x: x2, y: y2 - r }],
      [{ x: x2 - r, y: y2 }, { x: x1 + r, y: y2 }],
      [{ x: x1, y: y2 - r }, { x: x1, y: y1 + r }],
    ],
    arcs: [
      { c: { x: x2 - r, y: y1 + r }, r, startRad: -Math.PI / 2, endRad: 0 },
      { c: { x: x2 - r, y: y2 - r }, r, startRad: 0, endRad: Math.PI / 2 },
      { c: { x: x1 + r, y: y2 - r }, r, startRad: Math.PI / 2, endRad: Math.PI },
      { c: { x: x1 + r, y: y1 + r }, r, startRad: Math.PI, endRad: (3 * Math.PI) / 2 },
    ],
  }
}

export function rectSnapPoints(a: Vec2, b: Vec2, filletR?: number): Vec2[] {
  const bounds = rectFromAB(a, b)
  const r = effectiveRectFillet(bounds, filletR)
  const { x1, y1, x2, y2 } = bounds
  if (r <= 1e-9) {
    return [
      { x: x1, y: y1 },
      { x: x2, y: y1 },
      { x: x2, y: y2 },
      { x: x1, y: y2 },
    ]
  }
  return [
    { x: x1 + r, y: y1 },
    { x: x2 - r, y: y1 },
    { x: x2, y: y1 + r },
    { x: x2, y: y2 - r },
    { x: x2 - r, y: y2 },
    { x: x1 + r, y: y2 },
    { x: x1, y: y2 - r },
    { x: x1, y: y1 + r },
  ]
}

export function applyRectFillet(rect: RectEntity, radius: number): RectEntity | null {
  if (radius <= 1e-6) return null
  const range = rectFilletRadiusRange(rect.a, rect.b)
  if (!range || radius > range.max) return null
  return { ...rect, filletR: radius }
}

function normalizeAngle(a: number): number {
  let x = a % (Math.PI * 2)
  if (x < 0) x += Math.PI * 2
  return x
}

export function angleInArc(angle: number, startRad: number, endRad: number): boolean {
  const a = normalizeAngle(angle)
  const s = normalizeAngle(startRad)
  const e = normalizeAngle(endRad)
  if (s <= e) return a >= s - 1e-9 && a <= e + 1e-9
  return a >= s - 1e-9 || a <= e + 1e-9
}

export function arcTangentPoint(arc: RectArc, atStart: boolean): Vec2 {
  const t = atStart ? arc.startRad : arc.endRad
  return {
    x: arc.c.x + arc.r * Math.cos(t),
    y: arc.c.y + arc.r * Math.sin(t),
  }
}
