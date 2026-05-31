import type { Vec2 } from './types'

export function add(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x + b.x, y: a.y + b.y }
}
export function sub(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x - b.x, y: a.y - b.y }
}
export function mul(a: Vec2, s: number): Vec2 {
  return { x: a.x * s, y: a.y * s }
}
export function len(a: Vec2): number {
  return Math.hypot(a.x, a.y)
}
export function dist(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}
export function clamp01(t: number) {
  return Math.max(0, Math.min(1, t))
}

export function nearestPointOnSegment(p: Vec2, a: Vec2, b: Vec2): Vec2 {
  const ab = sub(b, a)
  const ap = sub(p, a)
  const denom = ab.x * ab.x + ab.y * ab.y
  if (denom <= 1e-12) return a
  const t = clamp01((ap.x * ab.x + ap.y * ab.y) / denom)
  return add(a, mul(ab, t))
}

export function snapOrtho(start: Vec2, current: Vec2): Vec2 {
  const dx = current.x - start.x
  const dy = current.y - start.y
  if (Math.abs(dx) >= Math.abs(dy)) return { x: current.x, y: start.y }
  return { x: start.x, y: current.y }
}

export function rectFromAB(a: Vec2, b: Vec2) {
  const x1 = Math.min(a.x, b.x)
  const x2 = Math.max(a.x, b.x)
  const y1 = Math.min(a.y, b.y)
  const y2 = Math.max(a.y, b.y)
  return { x1, y1, x2, y2, w: x2 - x1, h: y2 - y1 }
}

