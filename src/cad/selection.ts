import type { ArcEntity, CadEntity, Vec2 } from './types'
import { dist } from './geometry'
import { rectOutline, rectSnapPoints } from './rectFillet'
import { lineLineIntersection } from './entityEdit'

export type WorldBox = { x1: number; y1: number; x2: number; y2: number }
export type SelectMode = 'window' | 'crossing'

const EPS = 1e-6

export function worldBoxFromCorners(a: Vec2, b: Vec2): WorldBox {
  return {
    x1: Math.min(a.x, b.x),
    y1: Math.min(a.y, b.y),
    x2: Math.max(a.x, b.x),
    y2: Math.max(a.y, b.y),
  }
}

function pointInBox(p: Vec2, box: WorldBox): boolean {
  return p.x >= box.x1 && p.x <= box.x2 && p.y >= box.y1 && p.y <= box.y2
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n))
}

function rectCorners(a: Vec2, b: Vec2, filletR?: number): Vec2[] {
  return rectSnapPoints(a, b, filletR)
}

function boxEdges(box: WorldBox): [Vec2, Vec2][] {
  return [
    [{ x: box.x1, y: box.y1 }, { x: box.x2, y: box.y1 }],
    [{ x: box.x2, y: box.y1 }, { x: box.x2, y: box.y2 }],
    [{ x: box.x2, y: box.y2 }, { x: box.x1, y: box.y2 }],
    [{ x: box.x1, y: box.y2 }, { x: box.x1, y: box.y1 }],
  ]
}

function pointOnSegment(p: Vec2, a: Vec2, b: Vec2): boolean {
  if (dist(a, b) < EPS) return dist(p, a) < EPS
  const ap = dist(a, p)
  const pb = dist(p, b)
  return Math.abs(ap + pb - dist(a, b)) < EPS * 10
}

function segmentIntersectsBox(a: Vec2, b: Vec2, box: WorldBox): boolean {
  if (pointInBox(a, box) || pointInBox(b, box)) return true
  return boxEdges(box).some(([e1, e2]) => {
    const hit = lineLineIntersection(a, b, e1, e2)
    return hit !== null && pointOnSegment(hit, a, b) && pointOnSegment(hit, e1, e2)
  })
}

function circleCrossesBox(c: Vec2, r: number, box: WorldBox): boolean {
  if (pointInBox(c, box)) return true
  const closest = { x: clamp(c.x, box.x1, box.x2), y: clamp(c.y, box.y1, box.y2) }
  return dist(c, closest) <= r + EPS
}

function pointAtAngle(c: Vec2, r: number, deg: number): Vec2 {
  const rad = (deg * Math.PI) / 180
  return { x: c.x + r * Math.cos(rad), y: c.y + r * Math.sin(rad) }
}

function arcCrossesBox(e: ArcEntity, box: WorldBox): boolean {
  if (isEntityFullyInsideBox(e, box)) return true

  const start = pointAtAngle(e.c, e.r, e.startDeg)
  const end = pointAtAngle(e.c, e.r, e.endDeg)
  if (pointInBox(start, box) || pointInBox(end, box)) return true

  let sweep = e.endDeg - e.startDeg
  if (sweep > 180) sweep -= 360
  if (sweep < -180) sweep += 360

  const steps = 32
  let prev = start
  for (let i = 1; i <= steps; i++) {
    const p = pointAtAngle(e.c, e.r, e.startDeg + (sweep * i) / steps)
    if (pointInBox(p, box)) return true
    if (segmentIntersectsBox(prev, p, box)) return true
    prev = p
  }
  return false
}

function rectOutlineCrossesBox(a: Vec2, b: Vec2, filletR: number | undefined, box: WorldBox): boolean {
  const outline = rectOutline(a, b, filletR)
  if (outline.edges.some(([e1, e2]) => segmentIntersectsBox(e1, e2, box))) return true
  for (const arc of outline.arcs) {
    if (
      arcCrossesBox(
        {
          type: 'arc',
          c: arc.c,
          r: arc.r,
          startDeg: (arc.startRad * 180) / Math.PI,
          endDeg: (arc.endRad * 180) / Math.PI,
        } as ArcEntity,
        box,
      )
    ) {
      return true
    }
  }
  return false
}

export function isEntityFullyInsideBox(e: CadEntity, box: WorldBox): boolean {
  switch (e.type) {
    case 'line':
      return pointInBox(e.a, box) && pointInBox(e.b, box)
    case 'rect':
      return rectCorners(e.a, e.b, e.filletR).every((c) => pointInBox(c, box))
    case 'circle':
      return (
        e.c.x - e.r >= box.x1 &&
        e.c.x + e.r <= box.x2 &&
        e.c.y - e.r >= box.y1 &&
        e.c.y + e.r <= box.y2
      )
    case 'arc':
      return (
        e.c.x - e.r >= box.x1 &&
        e.c.x + e.r <= box.x2 &&
        e.c.y - e.r >= box.y1 &&
        e.c.y + e.r <= box.y2
      )
    case 'text':
      return pointInBox(e.p, box)
  }
}

export function isEntityCrossingBox(e: CadEntity, box: WorldBox): boolean {
  switch (e.type) {
    case 'line':
      return segmentIntersectsBox(e.a, e.b, box)
    case 'rect':
      return rectOutlineCrossesBox(e.a, e.b, e.filletR, box)
    case 'circle':
      return circleCrossesBox(e.c, e.r, box)
    case 'arc':
      return arcCrossesBox(e, box)
    case 'text':
      return pointInBox(e.p, box)
  }
}

export function selectEntitiesInBox(
  entities: CadEntity[],
  box: WorldBox,
  mode: SelectMode = 'window',
): CadEntity[] {
  const test = mode === 'window' ? isEntityFullyInsideBox : isEntityCrossingBox
  return entities.map((e) => ({
    ...e,
    selected: test(e, box),
  }))
}
