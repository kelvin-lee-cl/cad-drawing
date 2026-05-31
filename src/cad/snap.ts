import type { CadEntity, Vec2, Viewport } from './types'
import { dist } from './geometry'
import { rectSnapPoints } from './rectFillet'
import { worldToScreen } from './viewport'

const WORLD_ORIGIN: Vec2 = { x: 0, y: 0 }

export type SnapResult = {
  world: Vec2
  snapped: boolean
  snapTo?: 'endpoint' | 'center' | 'grid'
}

export type SnapSettings = {
  enabled: boolean
  endpoint: boolean
  center: boolean
  grid: boolean
  gridSizeWorld: number
  thresholdPx: number
}

export function getEntitySnapPoints(e: CadEntity): { p: Vec2; kind: 'endpoint' | 'center' }[] {
  switch (e.type) {
    case 'line':
      return [
        { p: e.a, kind: 'endpoint' },
        { p: e.b, kind: 'endpoint' },
      ]
    case 'rect':
      return rectSnapPoints(e.a, e.b, e.filletR).map((p) => ({ p, kind: 'endpoint' as const }))
    case 'circle':
      return [{ p: e.c, kind: 'center' }]
    case 'arc':
      return [{ p: e.c, kind: 'center' }]
    case 'text':
      return [{ p: e.p, kind: 'endpoint' }]
  }
}

/** @deprecated use getEntitySnapPoints */
export function getEntityEndpoints(e: CadEntity): Vec2[] {
  return getEntitySnapPoints(e).map((s) => s.p)
}

export function snapPoint(
  vp: Viewport,
  pWorld: Vec2,
  entities: CadEntity[],
  settings: SnapSettings,
): SnapResult {
  if (!settings.enabled) return { world: pWorld, snapped: false }

  let best: { dPx: number; p: Vec2; snapTo: 'endpoint' | 'center' } | null = null

  for (const e of entities) {
    for (const { p, kind } of getEntitySnapPoints(e)) {
      if (kind === 'endpoint' && !settings.endpoint) continue
      if (kind === 'center' && !settings.center) continue
      const dPx = dist(worldToScreen(vp, pWorld), worldToScreen(vp, p))
      if (dPx <= settings.thresholdPx && (!best || dPx < best.dPx)) {
        best = { dPx, p, snapTo: kind }
      }
    }
  }

  if (settings.endpoint) {
    const dPx = dist(worldToScreen(vp, pWorld), worldToScreen(vp, WORLD_ORIGIN))
    if (dPx <= settings.thresholdPx && (!best || dPx < best.dPx)) {
      best = { dPx, p: WORLD_ORIGIN, snapTo: 'endpoint' }
    }
  }

  if (best) return { world: best.p, snapped: true, snapTo: best.snapTo }

  if (settings.grid && settings.gridSizeWorld > 0) {
    const gs = settings.gridSizeWorld
    const gp = { x: Math.round(pWorld.x / gs) * gs, y: Math.round(pWorld.y / gs) * gs }
    const dPx = dist(worldToScreen(vp, pWorld), worldToScreen(vp, gp))
    if (dPx <= settings.thresholdPx) return { world: gp, snapped: true, snapTo: 'grid' }
  }

  return { world: pWorld, snapped: false }
}
