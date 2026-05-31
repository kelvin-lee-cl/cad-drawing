import type { CadEntity } from './types'
import { rectFromAB } from './geometry'

export type WorldBounds = {
  x1: number
  y1: number
  x2: number
  y2: number
}

export function unionBounds(a: WorldBounds, b: WorldBounds): WorldBounds {
  return {
    x1: Math.min(a.x1, b.x1),
    y1: Math.min(a.y1, b.y1),
    x2: Math.max(a.x2, b.x2),
    y2: Math.max(a.y2, b.y2),
  }
}

export function entityBounds(e: CadEntity): WorldBounds | null {
  switch (e.type) {
    case 'line': {
      let { x1, y1, x2, y2 } = rectFromAB(e.a, e.b)
      if (e.filletArc) {
        const { c, r } = e.filletArc
        x1 = Math.min(x1, c.x - r)
        y1 = Math.min(y1, c.y - r)
        x2 = Math.max(x2, c.x + r)
        y2 = Math.max(y2, c.y + r)
      }
      return { x1, y1, x2, y2 }
    }
    case 'rect':
      return rectFromAB(e.a, e.b)
    case 'circle':
      return { x1: e.c.x - e.r, y1: e.c.y - e.r, x2: e.c.x + e.r, y2: e.c.y + e.r }
    case 'arc':
      return { x1: e.c.x - e.r, y1: e.c.y - e.r, x2: e.c.x + e.r, y2: e.c.y + e.r }
    case 'text': {
      const w = Math.max(e.text.length, 1) * e.height * 0.55
      return { x1: e.p.x, y1: e.p.y, x2: e.p.x + w, y2: e.p.y + e.height }
    }
  }
}

export function boundsFromEntities(entities: CadEntity[]): WorldBounds | null {
  let bounds: WorldBounds | null = null
  for (const e of entities) {
    const b = entityBounds(e)
    if (!b) continue
    bounds = bounds ? unionBounds(bounds, b) : b
  }
  return bounds
}
