import type { CadEntity, Units, Vec2, Viewport } from './types'
import { dist, rectFromAB } from './geometry'
import { rectOutline } from './rectFillet'
import { worldToScreen } from './viewport'

/** Extra canvas padding when fitting extents with dimensions visible. */
export const DIMENSION_MARGIN_PX = 50

/** Screen-space gap between geometry and dimension labels. */
export const DIMENSION_LABEL_OFFSET_PX = 14

/** Stagger overlapping labels along the measured edge. */
const SPREAD_TANGENT_STEP_PX = 34
/** Small extra separation along the outward normal when still overlapping. */
const SPREAD_NORMAL_STEP_PX = 8
const LABEL_PAD_PX = 4
/** Minimum gap between label box and unrelated geometry (screen px). */
const LINE_CLEARANCE_PX = 5
const CIRCLE_SEGMENT_COUNT = 28

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
  /** Screen-space axes for collision spreading (optional). */
  spreadTangent?: Vec2
  spreadNormal?: Vec2
  /** Entity this dimension belongs to (excluded from line collision). */
  sourceEntityId?: string
}

/** Pick horizontal vs vertical text from line angle (whichever axis is closer). */
export function snapDimensionOrientation(angleRad: number): DimensionOrientation {
  let a = angleRad % Math.PI
  if (a < 0) a += Math.PI
  const distHorizontal = Math.min(a, Math.PI - a)
  const distVertical = Math.abs(a - Math.PI / 2)
  return distHorizontal <= distVertical ? 'horizontal' : 'vertical'
}

function lineScreenAxes(vp: Viewport, a: Vec2, b: Vec2): { tangent: Vec2; normal: Vec2 } {
  const sa = worldToScreen(vp, a)
  const sb = worldToScreen(vp, b)
  const dx = sb.x - sa.x
  const dy = sb.y - sa.y
  const len = Math.hypot(dx, dy)
  if (len < 1e-6) return { tangent: { x: 1, y: 0 }, normal: { x: 0, y: -1 } }
  return {
    tangent: { x: dx / len, y: dy / len },
    normal: { x: -dy / len, y: dx / len },
  }
}

function lineLabelScreenOffset(normal: Vec2, marginPx: number): Vec2 {
  return { x: normal.x * marginPx, y: normal.y * marginPx }
}

function withSource(labels: DimensionLabel[], entityId: string): DimensionLabel[] {
  return labels.map((label) => ({ ...label, sourceEntityId: entityId }))
}

export function getEntityDimensions(e: CadEntity, units: Units, vp: Viewport): DimensionLabel[] {
  const gap = DIMENSION_LABEL_OFFSET_PX
  switch (e.type) {
    case 'line': {
      const len = dist(e.a, e.b)
      const mid = { x: (e.a.x + e.b.x) / 2, y: (e.a.y + e.b.y) / 2 }
      const angle = Math.atan2(e.b.y - e.a.y, e.b.x - e.a.x)
      const { tangent, normal } = lineScreenAxes(vp, e.a, e.b)
      return withSource(
        [
          {
            text: formatLength(len, units),
            anchor: mid,
            screenOffset: lineLabelScreenOffset(normal, gap),
            orientation: snapDimensionOrientation(angle),
            spreadTangent: tangent,
            spreadNormal: normal,
          },
        ],
        e.id,
      )
    }
    case 'rect': {
      const r = rectFromAB(e.a, e.b)
      const cx = (r.x1 + r.x2) / 2
      const cy = (r.y1 + r.y2) / 2
      return withSource(
        [
          {
            text: formatLength(r.w, units),
            anchor: { x: cx, y: r.y1 },
            screenOffset: { x: 0, y: gap },
            orientation: 'horizontal',
            spreadTangent: { x: 1, y: 0 },
            spreadNormal: { x: 0, y: 1 },
          },
          {
            text: formatLength(r.h, units),
            anchor: { x: r.x2, y: cy },
            screenOffset: { x: gap, y: 0 },
            orientation: 'vertical',
            spreadTangent: { x: 0, y: 1 },
            spreadNormal: { x: 1, y: 0 },
          },
        ],
        e.id,
      )
    }
    case 'circle': {
      const d = e.r * 2
      return withSource(
        [
          {
            text: `Ø ${formatLength(d, units)}`,
            anchor: { x: e.c.x, y: e.c.y + e.r },
            screenOffset: { x: 0, y: -gap },
            spreadTangent: { x: 1, y: 0 },
            spreadNormal: { x: 0, y: -1 },
          },
        ],
        e.id,
      )
    }
    default:
      return []
  }
}

export function collectDimensionLabels(
  entities: CadEntity[],
  units: Units,
  vp: Viewport,
): DimensionLabel[] {
  const labels: DimensionLabel[] = []
  for (const e of entities) {
    if (e.type === 'line' || e.type === 'rect' || e.type === 'circle') {
      labels.push(...getEntityDimensions(e, units, vp))
    }
  }
  return labels
}

type ScreenSegment = {
  a: Vec2
  b: Vec2
  entityId: string
}

type LabelPlacement = {
  label: DimensionLabel
  pos: Vec2
  halfW: number
  halfH: number
  extraTangent: number
  extraNormal: number
  sideFlipped: boolean
}

type ScreenRect = { minX: number; minY: number; maxX: number; maxY: number }

function measureLabelHalfExtents(
  ctx: CanvasRenderingContext2D,
  label: DimensionLabel,
  fontSizePx: number,
): { halfW: number; halfH: number } {
  const textW = ctx.measureText(label.text).width
  const textH = fontSizePx
  if (label.orientation === 'vertical') {
    return { halfW: textH / 2, halfH: textW / 2 }
  }
  return { halfW: textW / 2, halfH: textH / 2 }
}

function effectiveOffset(label: DimensionLabel, sideFlipped: boolean): Vec2 {
  if (!sideFlipped) return label.screenOffset
  return { x: -label.screenOffset.x, y: -label.screenOffset.y }
}

function effectiveNormal(label: DimensionLabel, sideFlipped: boolean): Vec2 {
  const n = label.spreadNormal ?? { x: 0, y: -1 }
  if (!sideFlipped) return n
  return { x: -n.x, y: -n.y }
}

function screenPos(
  label: DimensionLabel,
  vp: Viewport,
  extraTangent: number,
  extraNormal: number,
  sideFlipped: boolean,
): Vec2 {
  const anchor = worldToScreen(vp, label.anchor)
  const t = label.spreadTangent ?? { x: 1, y: 0 }
  const n = effectiveNormal(label, sideFlipped)
  const offset = effectiveOffset(label, sideFlipped)
  return {
    x: anchor.x + offset.x + extraTangent * t.x + extraNormal * n.x,
    y: anchor.y + offset.y + extraTangent * t.y + extraNormal * n.y,
  }
}

function pushSegment(segments: ScreenSegment[], entityId: string, a: Vec2, b: Vec2): void {
  if (Math.hypot(b.x - a.x, b.y - a.y) < 0.5) return
  segments.push({ a, b, entityId })
}

function sampleArc(
  segments: ScreenSegment[],
  entityId: string,
  vp: Viewport,
  c: Vec2,
  r: number,
  startRad: number,
  endRad: number,
  steps = 8,
): void {
  let span = endRad - startRad
  while (span <= 0) span += Math.PI * 2
  for (let i = 0; i < steps; i++) {
    const t0 = startRad + (span * i) / steps
    const t1 = startRad + (span * (i + 1)) / steps
    const p0 = worldToScreen(vp, { x: c.x + r * Math.cos(t0), y: c.y + r * Math.sin(t0) })
    const p1 = worldToScreen(vp, { x: c.x + r * Math.cos(t1), y: c.y + r * Math.sin(t1) })
    pushSegment(segments, entityId, p0, p1)
  }
}

function collectScreenSegments(entities: CadEntity[], vp: Viewport): ScreenSegment[] {
  const segments: ScreenSegment[] = []
  for (const e of entities) {
    switch (e.type) {
      case 'line': {
        pushSegment(segments, e.id, worldToScreen(vp, e.a), worldToScreen(vp, e.b))
        if (e.filletArc) {
          const { c, r, corner, end } = e.filletArc
          const startRad = Math.atan2(corner.y - c.y, corner.x - c.x)
          const endRad = Math.atan2(end.y - c.y, end.x - c.x)
          sampleArc(segments, e.id, vp, c, r, startRad, endRad, 10)
        }
        break
      }
      case 'rect': {
        const outline = rectOutline(e.a, e.b, e.filletR)
        for (const [a, b] of outline.edges) {
          pushSegment(segments, e.id, worldToScreen(vp, a), worldToScreen(vp, b))
        }
        for (const arc of outline.arcs) {
          sampleArc(segments, e.id, vp, arc.c, arc.r, arc.startRad, arc.endRad, 6)
        }
        break
      }
      case 'circle': {
        for (let i = 0; i < CIRCLE_SEGMENT_COUNT; i++) {
          const t0 = (2 * Math.PI * i) / CIRCLE_SEGMENT_COUNT
          const t1 = (2 * Math.PI * (i + 1)) / CIRCLE_SEGMENT_COUNT
          const p0 = worldToScreen(vp, {
            x: e.c.x + e.r * Math.cos(t0),
            y: e.c.y + e.r * Math.sin(t0),
          })
          const p1 = worldToScreen(vp, {
            x: e.c.x + e.r * Math.cos(t1),
            y: e.c.y + e.r * Math.sin(t1),
          })
          pushSegment(segments, e.id, p0, p1)
        }
        break
      }
    }
  }
  return segments
}

function cross2(a: Vec2, b: Vec2, c: Vec2): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
}

function onSegment(a: Vec2, b: Vec2, p: Vec2): boolean {
  return (
    Math.min(a.x, b.x) - 1e-6 <= p.x &&
    p.x <= Math.max(a.x, b.x) + 1e-6 &&
    Math.min(a.y, b.y) - 1e-6 <= p.y &&
    p.y <= Math.max(a.y, b.y) + 1e-6
  )
}

function segmentsIntersect(sa: Vec2, sb: Vec2, ta: Vec2, tb: Vec2): boolean {
  const d1 = cross2(sa, sb, ta)
  const d2 = cross2(sa, sb, tb)
  const d3 = cross2(ta, tb, sa)
  const d4 = cross2(ta, tb, sb)

  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
    return true
  }
  if (Math.abs(d1) < 1e-9 && onSegment(sa, sb, ta)) return true
  if (Math.abs(d2) < 1e-9 && onSegment(sa, sb, tb)) return true
  if (Math.abs(d3) < 1e-9 && onSegment(ta, tb, sa)) return true
  if (Math.abs(d4) < 1e-9 && onSegment(ta, tb, sb)) return true
  return false
}

function pointInRect(p: Vec2, rect: ScreenRect): boolean {
  return p.x >= rect.minX && p.x <= rect.maxX && p.y >= rect.minY && p.y <= rect.maxY
}

function segmentIntersectsRect(sa: Vec2, sb: Vec2, rect: ScreenRect): boolean {
  if (pointInRect(sa, rect) || pointInRect(sb, rect)) return true
  const corners: Vec2[] = [
    { x: rect.minX, y: rect.minY },
    { x: rect.maxX, y: rect.minY },
    { x: rect.maxX, y: rect.maxY },
    { x: rect.minX, y: rect.maxY },
  ]
  for (let i = 0; i < 4; i++) {
    const c0 = corners[i]
    const c1 = corners[(i + 1) % 4]
    if (segmentsIntersect(sa, sb, c0, c1)) return true
  }
  return false
}

function placementClearanceRect(p: LabelPlacement): ScreenRect {
  return {
    minX: p.pos.x - p.halfW - LINE_CLEARANCE_PX,
    minY: p.pos.y - p.halfH - LINE_CLEARANCE_PX,
    maxX: p.pos.x + p.halfW + LINE_CLEARANCE_PX,
    maxY: p.pos.y + p.halfH + LINE_CLEARANCE_PX,
  }
}

function geometryCollisionCount(
  placement: LabelPlacement,
  segments: ScreenSegment[],
): number {
  const rect = placementClearanceRect(placement)
  const sourceId = placement.label.sourceEntityId
  let hits = 0
  for (const seg of segments) {
    if (sourceId && seg.entityId === sourceId) continue
    if (segmentIntersectsRect(seg.a, seg.b, rect)) hits++
  }
  return hits
}

function flipPlacementSide(p: LabelPlacement): void {
  p.sideFlipped = !p.sideFlipped
  p.extraNormal = -p.extraNormal
}

function avoidGeometryCollisions(
  placements: LabelPlacement[],
  segments: ScreenSegment[],
  vp: Viewport,
): void {
  for (const p of placements) {
    p.pos = screenPos(p.label, vp, p.extraTangent, p.extraNormal, p.sideFlipped)
    const initialHits = geometryCollisionCount(p, segments)
    if (initialHits === 0) continue

    const wasFlipped = p.sideFlipped
    flipPlacementSide(p)
    p.pos = screenPos(p.label, vp, p.extraTangent, p.extraNormal, p.sideFlipped)
    const flippedHits = geometryCollisionCount(p, segments)

    if (flippedHits < initialHits) continue

    if (flippedHits > initialHits) {
      flipPlacementSide(p)
      p.pos = screenPos(p.label, vp, p.extraTangent, p.extraNormal, p.sideFlipped)
      continue
    }

    // Tie: keep the side that was not flipped originally.
    if (wasFlipped) {
      flipPlacementSide(p)
      p.pos = screenPos(p.label, vp, p.extraTangent, p.extraNormal, p.sideFlipped)
    }
  }
}

function placementsOverlap(a: LabelPlacement, b: LabelPlacement): boolean {
  const dx = Math.abs(a.pos.x - b.pos.x)
  const dy = Math.abs(a.pos.y - b.pos.y)
  return (
    dx < a.halfW + b.halfW + LABEL_PAD_PX && dy < a.halfH + b.halfH + LABEL_PAD_PX
  )
}

function refreshPositions(placements: LabelPlacement[], vp: Viewport): void {
  for (const p of placements) {
    p.pos = screenPos(p.label, vp, p.extraTangent, p.extraNormal, p.sideFlipped)
  }
}

function clusterOverlapping(placements: LabelPlacement[]): LabelPlacement[][] {
  const n = placements.length
  const parent = placements.map((_, i) => i)
  const find = (i: number): number => {
    if (parent[i] !== i) parent[i] = find(parent[i])
    return parent[i]
  }
  const unite = (a: number, b: number) => {
    parent[find(a)] = find(b)
  }

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (!placementsOverlap(placements[i], placements[j])) continue
      const ni = placements[i].label.spreadNormal ?? { x: 0, y: -1 }
      const nj = placements[j].label.spreadNormal ?? { x: 0, y: -1 }
      const aligned = Math.abs(ni.x * nj.x + ni.y * nj.y) > 0.75
      if (aligned) unite(i, j)
    }
  }

  const groups = new Map<number, LabelPlacement[]>()
  for (let i = 0; i < n; i++) {
    const root = find(i)
    const list = groups.get(root) ?? []
    list.push(placements[i])
    groups.set(root, list)
  }
  return [...groups.values()]
}

function spreadCluster(cluster: LabelPlacement[], vp: Viewport): void {
  if (cluster.length <= 1) return

  const n = cluster[0].label.spreadNormal ?? { x: 0, y: -1 }

  cluster.sort((a, b) => {
    const pa = a.pos.x * n.x + a.pos.y * n.y
    const pb = b.pos.x * n.x + b.pos.y * n.y
    return pa - pb
  })

  const count = cluster.length
  for (let i = 0; i < count; i++) {
    cluster[i].extraTangent = (i - (count - 1) / 2) * SPREAD_TANGENT_STEP_PX
  }
  refreshPositions(cluster, vp)

  let stillOverlapping = true
  for (let pass = 0; pass < 3 && stillOverlapping; pass++) {
    stillOverlapping = false
    for (let i = 0; i < count; i++) {
      for (let j = i + 1; j < count; j++) {
        if (!placementsOverlap(cluster[i], cluster[j])) continue
        stillOverlapping = true
        cluster[i].extraNormal -= SPREAD_NORMAL_STEP_PX / 2
        cluster[j].extraNormal += SPREAD_NORMAL_STEP_PX / 2
      }
    }
    refreshPositions(cluster, vp)
  }
}

/** Spread overlapping labels while keeping base offset close to each edge. */
export function layoutDimensionLabels(
  ctx: CanvasRenderingContext2D,
  labels: DimensionLabel[],
  vp: Viewport,
  entities: CadEntity[],
  fontSizePx = 11,
): DimensionLabel[] {
  if (labels.length === 0) return labels

  const segments = collectScreenSegments(entities, vp)

  ctx.save()
  ctx.font = `${fontSizePx}px ui-monospace, monospace`

  const placements: LabelPlacement[] = labels.map((label) => {
    const { halfW, halfH } = measureLabelHalfExtents(ctx, label, fontSizePx)
    const placement: LabelPlacement = {
      label,
      pos: { x: 0, y: 0 },
      halfW,
      halfH,
      extraTangent: 0,
      extraNormal: 0,
      sideFlipped: false,
    }
    placement.pos = screenPos(label, vp, 0, 0, false)
    return placement
  })

  ctx.restore()

  avoidGeometryCollisions(placements, segments, vp)

  if (placements.length > 1) {
    for (const cluster of clusterOverlapping(placements)) {
      spreadCluster(cluster, vp)
    }
    avoidGeometryCollisions(placements, segments, vp)
  }

  return placements.map((p) => {
    const t = p.label.spreadTangent ?? { x: 1, y: 0 }
    const n = effectiveNormal(p.label, p.sideFlipped)
    const offset = effectiveOffset(p.label, p.sideFlipped)
    return {
      ...p.label,
      screenOffset: {
        x: offset.x + p.extraTangent * t.x + p.extraNormal * n.x,
        y: offset.y + p.extraTangent * t.y + p.extraNormal * n.y,
      },
      spreadTangent: undefined,
      spreadNormal: undefined,
      sourceEntityId: undefined,
    }
  })
}
