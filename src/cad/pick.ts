import type { CadEntity, Vec2, Viewport } from './types'
import { dist, nearestPointOnSegment } from './geometry'
import { angleInArc, arcTangentPoint, rectOutline } from './rectFillet'
import { worldToScreen } from './viewport'

const HIT_PX = 8

function distPx(vp: Viewport, a: Vec2, b: Vec2): number {
  const sa = worldToScreen(vp, a)
  const sb = worldToScreen(vp, b)
  return Math.hypot(sa.x - sb.x, sa.y - sb.y)
}

function pointToSegmentDistPx(vp: Viewport, p: Vec2, a: Vec2, b: Vec2): number {
  const nearest = nearestPointOnSegment(p, a, b)
  return distPx(vp, p, nearest)
}

export function hitTestEntity(
  vp: Viewport,
  entities: CadEntity[],
  world: Vec2,
): CadEntity | null {
  let best: { e: CadEntity; d: number } | null = null

  for (let i = entities.length - 1; i >= 0; i--) {
    const e = entities[i]
    let d = Infinity

    switch (e.type) {
      case 'line': {
        d = pointToSegmentDistPx(vp, world, e.a, e.b)
        if (e.filletArc) {
          const ring = Math.abs(dist(world, e.filletArc.c) - e.filletArc.r) * vp.zoom
          d = Math.min(d, ring)
        }
        break
      }
      case 'rect': {
        const outline = rectOutline(e.a, e.b, e.filletR)
        d = Math.min(...outline.edges.map(([a, b]) => pointToSegmentDistPx(vp, world, a, b)))
        for (const arc of outline.arcs) {
          const ring = Math.abs(dist(world, arc.c) - arc.r) * vp.zoom
          if (angleInArc(Math.atan2(world.y - arc.c.y, world.x - arc.c.x), arc.startRad, arc.endRad)) {
            d = Math.min(d, ring)
          } else {
            const p0 = arcTangentPoint(arc, true)
            const p1 = arcTangentPoint(arc, false)
            d = Math.min(d, distPx(vp, world, p0), distPx(vp, world, p1))
          }
        }
        break
      }
      case 'circle':
      case 'arc': {
        const ring = Math.abs(dist(world, e.c) - e.r) * vp.zoom
        d = ring
        break
      }
      case 'text': {
        d = distPx(vp, world, e.p)
        break
      }
    }

    if (d <= HIT_PX && (!best || d < best.d)) {
      best = { e, d }
    }
  }

  return best?.e ?? null
}
