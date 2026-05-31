import type { CadEntity, LineEntity, Vec2 } from './types'
import { add, dist, mul, rectFromAB, sub } from './geometry'
import { lineLineIntersection } from './entityEdit'
import { angleInArc, rectOutline } from './rectFillet'
import { newId } from './id'
import type { WorldBox } from './selection'

const EPS = 1e-6

function pointInBox(p: Vec2, box: WorldBox): boolean {
  return p.x >= box.x1 && p.x <= box.x2 && p.y >= box.y1 && p.y <= box.y2
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n))
}

function trimBoxEdges(box: WorldBox): [Vec2, Vec2][] {
  return [
    [{ x: box.x1, y: box.y1 }, { x: box.x2, y: box.y1 }],
    [{ x: box.x2, y: box.y1 }, { x: box.x2, y: box.y2 }],
    [{ x: box.x2, y: box.y2 }, { x: box.x1, y: box.y2 }],
    [{ x: box.x1, y: box.y2 }, { x: box.x1, y: box.y1 }],
  ]
}

function paramOnSegment(a: Vec2, b: Vec2, p: Vec2): number {
  const ab = sub(b, a)
  const denom = ab.x * ab.x + ab.y * ab.y
  if (denom < EPS * EPS) return 0
  return ((p.x - a.x) * ab.x + (p.y - a.y) * ab.y) / denom
}

function pointAt(a: Vec2, b: Vec2, t: number): Vec2 {
  return add(a, mul(sub(b, a), t))
}

function pointOnSegment(p: Vec2, a: Vec2, b: Vec2): boolean {
  if (dist(a, b) < EPS) return dist(p, a) < EPS
  const ap = dist(a, p)
  const pb = dist(p, b)
  return Math.abs(ap + pb - dist(a, b)) < EPS * 10
}

function segmentIntersectsBox(a: Vec2, b: Vec2, box: WorldBox): boolean {
  if (pointInBox(a, box) || pointInBox(b, box)) return true
  return trimBoxEdges(box).some(([e1, e2]) => {
    const hit = lineLineIntersection(a, b, e1, e2)
    return hit !== null && pointOnSegment(hit, a, b) && pointOnSegment(hit, e1, e2)
  })
}

function isLineFullyInsideBox(a: Vec2, b: Vec2, box: WorldBox): boolean {
  return pointInBox(a, box) && pointInBox(b, box)
}

function isEntityFullyInsideTrimBox(e: CadEntity, box: WorldBox): boolean {
  switch (e.type) {
    case 'line':
      return isLineFullyInsideBox(e.a, e.b, box)
    case 'rect': {
      const r = rectFromAB(e.a, e.b)
      return (
        pointInBox({ x: r.x1, y: r.y1 }, box) &&
        pointInBox({ x: r.x2, y: r.y2 }, box)
      )
    }
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

function pushUniqueT(ts: number[], t: number) {
  if (t < -EPS || t > 1 + EPS) return
  const c = clamp(t, 0, 1)
  if (!ts.some((x) => Math.abs(x - c) < EPS)) ts.push(c)
}

function lineRectBoundaryTs(a: Vec2, b: Vec2, box: WorldBox): number[] {
  const ts: number[] = []
  for (const [e1, e2] of trimBoxEdges(box)) {
    const hit = lineLineIntersection(a, b, e1, e2)
    if (hit && pointOnSegment(hit, a, b) && pointOnSegment(hit, e1, e2)) {
      pushUniqueT(ts, paramOnSegment(a, b, hit))
    }
  }
  return ts
}

function segmentCircleIntersectionTs(a: Vec2, b: Vec2, c: Vec2, r: number): number[] {
  const d = sub(b, a)
  const f = sub(a, c)
  const A = d.x * d.x + d.y * d.y
  const B = 2 * (f.x * d.x + f.y * d.y)
  const C = f.x * f.x + f.y * f.y - r * r
  const disc = B * B - 4 * A * C
  if (disc < 0 || A < EPS) return []
  const s = Math.sqrt(disc)
  const ts: number[] = []
  for (const t of [(-B - s) / (2 * A), (-B + s) / (2 * A)]) {
    pushUniqueT(ts, t)
  }
  return ts
}

function lineOtherGeometryTs(
  a: Vec2,
  b: Vec2,
  selfId: string,
  entities: CadEntity[],
): number[] {
  const ts: number[] = []

  for (const other of entities) {
    if (other.id === selfId) continue

    if (other.type === 'line') {
      const hit = lineLineIntersection(a, b, other.a, other.b)
      if (hit && pointOnSegment(hit, a, b) && pointOnSegment(hit, other.a, other.b)) {
        pushUniqueT(ts, paramOnSegment(a, b, hit))
      }
      continue
    }

    if (other.type === 'rect') {
      const outline = rectOutline(other.a, other.b, other.filletR)
      for (const [e1, e2] of outline.edges) {
        const hit = lineLineIntersection(a, b, e1, e2)
        if (hit && pointOnSegment(hit, a, b) && pointOnSegment(hit, e1, e2)) {
          pushUniqueT(ts, paramOnSegment(a, b, hit))
        }
      }
      for (const arc of outline.arcs) {
        for (const t of segmentCircleIntersectionTs(a, b, arc.c, arc.r)) {
          const p = add(a, mul(sub(b, a), t))
          const ang = Math.atan2(p.y - arc.c.y, p.x - arc.c.x)
          if (angleInArc(ang, arc.startRad, arc.endRad)) {
            pushUniqueT(ts, t)
          }
        }
      }
      continue
    }

    if (other.type === 'circle' || other.type === 'arc') {
      for (const t of segmentCircleIntersectionTs(a, b, other.c, other.r)) {
        pushUniqueT(ts, t)
      }
    }
  }

  return ts
}

function nearestTInDirection(from: number, dir: -1 | 1, candidates: number[]): number | null {
  let best: number | null = null
  for (const t of candidates) {
    if (Math.abs(t - from) < EPS) continue
    const delta = t - from
    if (dir < 0 && delta >= -EPS) continue
    if (dir > 0 && delta <= EPS) continue
    if (best == null || Math.abs(t - from) < Math.abs(best - from)) best = t
  }
  return best
}

function segmentTouchesTrimBox(a: Vec2, b: Vec2, box: WorldBox): boolean {
  return segmentIntersectsBox(a, b, box)
}

function mergeIntervals(intervals: [number, number][]): [number, number][] {
  if (!intervals.length) return []
  const sorted = [...intervals].sort((x, y) => x[0] - y[0])
  const out: [number, number][] = [sorted[0]]
  for (let i = 1; i < sorted.length; i++) {
    const last = out[out.length - 1]
    if (sorted[i][0] <= last[1] + EPS) {
      last[1] = Math.max(last[1], sorted[i][1])
    } else {
      out.push(sorted[i])
    }
  }
  return out
}

function subtractIntervals(remove: [number, number][]): [number, number][] {
  const merged = mergeIntervals(remove)
  const keep: [number, number][] = []
  let cursor = 0
  for (const [r0, r1] of merged) {
    if (r0 > cursor + EPS) keep.push([cursor, r0])
    cursor = Math.max(cursor, r1)
  }
  if (cursor < 1 - EPS) keep.push([cursor, 1])
  return keep
}

function segmentMidpointInsideBox(a: Vec2, b: Vec2, t0: number, t1: number, box: WorldBox): boolean {
  const mid = pointAt(a, b, (t0 + t1) / 2)
  return pointInBox(mid, box)
}

function interiorRemovalIntervals(
  a: Vec2,
  b: Vec2,
  box: WorldBox,
  breakpoints: number[],
): [number, number][] {
  const ts = [0, 1, ...breakpoints].sort((x, y) => x - y)
  const unique: number[] = []
  for (const t of ts) {
    if (!unique.length || Math.abs(t - unique[unique.length - 1]) > EPS) unique.push(t)
  }

  const remove: [number, number][] = []
  for (let i = 0; i < unique.length - 1; i++) {
    const t0 = unique[i]
    const t1 = unique[i + 1]
    if (t1 - t0 < EPS) continue
    if (segmentMidpointInsideBox(a, b, t0, t1, box)) {
      remove.push([t0, t1])
    }
  }
  return remove
}

function trimLineByRectAndObjects(
  line: LineEntity,
  box: WorldBox,
  entities: CadEntity[],
): LineEntity[] {
  const { a, b } = line

  if (!segmentIntersectsBox(a, b, box)) return [line]

  const tRect = lineRectBoundaryTs(a, b, box)
  const tOther = lineOtherGeometryTs(a, b, line.id, entities)
  const breakpoints = [...tRect, ...tOther]

  const remove: [number, number][] = []

  for (const tR of tRect) {
    for (const dir of [-1, 1] as const) {
      const tStop = nearestTInDirection(tR, dir, tOther)
      if (tStop == null) continue

      const t0 = Math.min(tR, tStop)
      const t1 = Math.max(tR, tStop)
      const p0 = pointAt(a, b, t0)
      const p1 = pointAt(a, b, t1)
      if (!segmentTouchesTrimBox(p0, p1, box)) continue

      remove.push([t0, t1])
    }
  }

  remove.push(...interiorRemovalIntervals(a, b, box, breakpoints))

  if (!remove.length) return [line]

  const keep = subtractIntervals(remove)
  const pieces: LineEntity[] = []
  for (let i = 0; i < keep.length; i++) {
    const [t0, t1] = keep[i]
    const pa = pointAt(a, b, t0)
    const pb = pointAt(a, b, t1)
    if (dist(pa, pb) < EPS) continue
    pieces.push({
      ...line,
      id: i === 0 ? line.id : newId('line'),
      a: pa,
      b: pb,
    })
  }
  return pieces.length ? pieces : []
}

function trimEntity(e: CadEntity, box: WorldBox, entities: CadEntity[]): CadEntity[] {
  if (isEntityFullyInsideTrimBox(e, box)) return []

  if (e.type === 'line') {
    if (!segmentIntersectsBox(e.a, e.b, box)) return [e]
    return trimLineByRectAndObjects(e, box, entities)
  }

  return [e]
}

export function applyTrimByRect(entities: CadEntity[], box: WorldBox): CadEntity[] {
  const out: CadEntity[] = []
  for (const e of entities) {
    out.push(...trimEntity(e, box, entities))
  }
  return out
}
