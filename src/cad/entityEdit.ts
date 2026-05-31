import type { CadEntity, LineEntity, Vec2 } from './types'
import { add, dist, len, mul, nearestPointOnSegment, rectFromAB, sub } from './geometry'
import { newId } from './id'

function scalePoint(p: Vec2, base: Vec2, factor: number): Vec2 {
  return add(base, mul(sub(p, base), factor))
}

function rotatePointClockwise(p: Vec2, base: Vec2, angleDeg: number): Vec2 {
  const rad = (angleDeg * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const dx = p.x - base.x
  const dy = p.y - base.y
  return { x: base.x + dx * cos + dy * sin, y: base.y - dx * sin + dy * cos }
}

export function rotateEntity(e: CadEntity, base: Vec2, angleDeg: number): CadEntity {
  switch (e.type) {
    case 'line':
      return {
        ...e,
        a: rotatePointClockwise(e.a, base, angleDeg),
        b: rotatePointClockwise(e.b, base, angleDeg),
        filletArc: e.filletArc
          ? {
              ...e.filletArc,
              c: rotatePointClockwise(e.filletArc.c, base, angleDeg),
              end: rotatePointClockwise(e.filletArc.end, base, angleDeg),
              corner: rotatePointClockwise(e.filletArc.corner, base, angleDeg),
              through: rotatePointClockwise(e.filletArc.through, base, angleDeg),
            }
          : undefined,
      }
    case 'rect':
      return {
        ...e,
        a: rotatePointClockwise(e.a, base, angleDeg),
        b: rotatePointClockwise(e.b, base, angleDeg),
      }
    case 'circle':
      return { ...e, c: rotatePointClockwise(e.c, base, angleDeg) }
    case 'arc':
      return {
        ...e,
        c: rotatePointClockwise(e.c, base, angleDeg),
        startDeg: e.startDeg - angleDeg,
        endDeg: e.endDeg - angleDeg,
      }
    case 'text':
      return {
        ...e,
        p: rotatePointClockwise(e.p, base, angleDeg),
        rotationDeg: (e.rotationDeg ?? 0) + angleDeg,
      }
  }
}

export function scaleEntity(e: CadEntity, base: Vec2, factor: number): CadEntity {
  const absFactor = Math.abs(factor)
  switch (e.type) {
    case 'line':
      return {
        ...e,
        a: scalePoint(e.a, base, factor),
        b: scalePoint(e.b, base, factor),
        filletArc: e.filletArc
          ? {
              ...e.filletArc,
              c: scalePoint(e.filletArc.c, base, factor),
              r: e.filletArc.r * absFactor,
              end: scalePoint(e.filletArc.end, base, factor),
              corner: scalePoint(e.filletArc.corner, base, factor),
              through: scalePoint(e.filletArc.through, base, factor),
            }
          : undefined,
      }
    case 'rect':
      return {
        ...e,
        a: scalePoint(e.a, base, factor),
        b: scalePoint(e.b, base, factor),
        filletR: e.filletR != null ? e.filletR * absFactor : undefined,
      }
    case 'circle':
    case 'arc':
      return {
        ...e,
        c: scalePoint(e.c, base, factor),
        r: e.r * absFactor,
      }
    case 'text':
      return {
        ...e,
        p: scalePoint(e.p, base, factor),
        height: e.height * absFactor,
      }
  }
}

export function translateEntity(e: CadEntity, delta: Vec2): CadEntity {
  switch (e.type) {
    case 'line':
      return {
        ...e,
        a: add(e.a, delta),
        b: add(e.b, delta),
        filletArc: e.filletArc
          ? {
              ...e.filletArc,
              c: add(e.filletArc.c, delta),
              end: add(e.filletArc.end, delta),
              corner: add(e.filletArc.corner, delta),
              through: add(e.filletArc.through, delta),
            }
          : undefined,
      }
    case 'rect':
      return { ...e, a: add(e.a, delta), b: add(e.b, delta) }
    case 'circle':
    case 'arc':
      return { ...e, c: add(e.c, delta) }
    case 'text':
      return { ...e, p: add(e.p, delta) }
  }
}

export function cloneEntity(e: CadEntity, layerId: string): CadEntity {
  const base = { ...e, id: newId(e.type), layerId, selected: true }
  return base
}

export function offsetLineSegment(a: Vec2, b: Vec2, distance: number): { a: Vec2; b: Vec2 } {
  const ab = sub(b, a)
  const L = len(ab)
  if (L < 1e-9) return { a, b }
  const nx = -ab.y / L
  const ny = ab.x / L
  const o = { x: nx * distance, y: ny * distance }
  return { a: add(a, o), b: add(b, o) }
}

export function signedSideOfLine(p: Vec2, a: Vec2, b: Vec2): number {
  return (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)
}

export function offsetEntity(e: CadEntity, distance: number): CadEntity | null {
  switch (e.type) {
    case 'line': {
      const { a, b } = offsetLineSegment(e.a, e.b, distance)
      return { ...e, a, b, filletArc: undefined }
    }
    case 'circle':
      return { ...e, r: Math.max(1e-6, e.r + distance) }
    case 'rect': {
      const dx = e.b.x - e.a.x
      const dy = e.b.y - e.a.y
      const sx = dx >= 0 ? 1 : -1
      const sy = dy >= 0 ? 1 : -1
      return {
        ...e,
        a: { x: e.a.x - sx * distance, y: e.a.y - sy * distance },
        b: { x: e.b.x + sx * distance, y: e.b.y + sy * distance },
        filletR: undefined,
      }
    }
    default:
      return null
  }
}

export function lineLineIntersection(a1: Vec2, a2: Vec2, b1: Vec2, b2: Vec2): Vec2 | null {
  const d1 = sub(a2, a1)
  const d2 = sub(b2, b1)
  const cross = d1.x * d2.y - d1.y * d2.x
  if (Math.abs(cross) < 1e-12) return null
  const t = ((b1.x - a1.x) * d2.y - (b1.y - a1.y) * d2.x) / cross
  return add(a1, mul(d1, t))
}

function pointOnSegment(p: Vec2, a: Vec2, b: Vec2, eps = 1e-6): boolean {
  if (dist(a, b) < eps) return dist(p, a) < eps
  const ap = dist(a, p)
  const pb = dist(p, b)
  return Math.abs(ap + pb - dist(a, b)) < eps * 10
}

export function trimLineByLine(
  target: LineEntity,
  cutter: LineEntity,
  keepPoint: Vec2,
): LineEntity | null {
  const hit = lineLineIntersection(target.a, target.b, cutter.a, cutter.b)
  if (!hit) return null
  if (!pointOnSegment(hit, target.a, target.b)) return null

  const keepA = dist(keepPoint, target.a) <= dist(keepPoint, target.b)
  if (keepA) {
    if (dist(hit, target.a) < 1e-6) return null
    return { ...target, b: hit }
  }
  if (dist(hit, target.b) < 1e-6) return null
  return { ...target, a: hit }
}

type FilletSetup = {
  intersection: Vec2
  dir1: Vec2
  dir2: Vec2
  angle: number
  maxTrim: number
}

function filletSetup(l1: LineEntity, l2: LineEntity): FilletSetup | null {
  const i = lineLineIntersection(l1.a, l1.b, l2.a, l2.b)
  if (!i) return null

  const dir1 = unitFrom(i, farFrom(i, l1.a, l1.b))
  const dir2 = unitFrom(i, farFrom(i, l2.a, l2.b))
  if (!dir1 || !dir2) return null

  const dot = dir1.x * dir2.x + dir1.y * dir2.y
  const angle = Math.acos(Math.max(-1, Math.min(1, dot)))
  if (angle < 1e-4 || angle > Math.PI - 1e-4) return null

  const maxTrim =
    Math.min(
      dist(i, farFrom(i, l1.a, l1.b)),
      dist(i, farFrom(i, l2.a, l2.b)),
    ) * 0.95
  return { intersection: i, dir1, dir2, angle, maxTrim }
}

export function filletRadiusRange(
  l1: LineEntity,
  l2: LineEntity,
): { min: number; max: number } | null {
  const setup = filletSetup(l1, l2)
  if (!setup) return null
  const max = setup.maxTrim * Math.tan(setup.angle / 2)
  if (max <= 1e-6) return null
  const min = Math.max(1e-6, Math.min(max * 0.01, max * 0.99))
  return { min, max }
}

export function filletTwoLines(
  l1: LineEntity,
  l2: LineEntity,
  radius: number,
): CadEntity[] | null {
  if (radius <= 1e-6) return null
  const setup = filletSetup(l1, l2)
  if (!setup) return null

  const tanHalf = Math.tan(setup.angle / 2)
  const trimLen = radius / tanHalf
  if (trimLen > setup.maxTrim) return null

  const i = setup.intersection
  const dir1 = setup.dir1
  const dir2 = setup.dir2
  const angle = setup.angle

  const t1 = add(i, mul(dir1, trimLen))
  const t2 = add(i, mul(dir2, trimLen))

  const bis = len({ x: dir1.x + dir2.x, y: dir1.y + dir2.y })
  if (bis < 1e-9) return null
  const bx = (dir1.x + dir2.x) / bis
  const by = (dir1.y + dir2.y) / bis
  const centerDist = radius / Math.sin(angle / 2)
  const center = add(i, { x: bx * centerDist, y: by * centerDist })

  const far2 = farFrom(i, l2.a, l2.b)

  const newL1: LineEntity = {
    ...l1,
    a: farFrom(i, l1.a, l1.b),
    b: t1,
    filletArc: { c: center, r: radius, end: t2, corner: i, through: far2 },
  }
  const newL2: LineEntity = { ...l2, a: t2, b: far2, filletArc: undefined }

  return [newL1, newL2]
}

function farFrom(i: Vec2, a: Vec2, b: Vec2): Vec2 {
  return dist(i, a) >= dist(i, b) ? a : b
}

function unitFrom(from: Vec2, to: Vec2): Vec2 | null {
  const v = sub(to, from)
  const L = len(v)
  if (L < 1e-9) return null
  return { x: v.x / L, y: v.y / L }
}

export function offsetDistanceForEntity(e: CadEntity, pick: Vec2): number | null {
  switch (e.type) {
    case 'line': {
      const side = Math.sign(signedSideOfLine(pick, e.a, e.b)) || 1
      const nearest = nearestPointOnSegment(pick, e.a, e.b)
      return dist(pick, nearest) * side
    }
    case 'circle': {
      const d = dist(pick, e.c) - e.r
      return d
    }
    case 'rect': {
      const r = rectFromAB(e.a, e.b)
      const inside =
        pick.x >= r.x1 && pick.x <= r.x2 && pick.y >= r.y1 && pick.y <= r.y2
      const toEdge = Math.min(
        pick.x - r.x1,
        r.x2 - pick.x,
        pick.y - r.y1,
        r.y2 - pick.y,
      )
      return inside ? -toEdge : toEdge
    }
    default:
      return null
  }
}

export function lineEntity(e: CadEntity): LineEntity | null {
  if (e.type === 'line') return e
  if (e.type === 'rect') {
    const r = {
      x1: Math.min(e.a.x, e.b.x),
      y1: Math.min(e.a.y, e.b.y),
      x2: Math.max(e.a.x, e.b.x),
      y2: Math.max(e.a.y, e.b.y),
    }
    return {
      id: e.id,
      type: 'line',
      layerId: e.layerId,
      a: { x: r.x1, y: r.y1 },
      b: { x: r.x2, y: r.y1 },
    }
  }
  return null
}
