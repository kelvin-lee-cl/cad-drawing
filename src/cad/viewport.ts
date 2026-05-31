import type { Vec2, Viewport } from './types'
import type { WorldBounds } from './bounds'
import { DIMENSION_MARGIN_PX } from './dimensions'

/** px per world unit — allow zooming out to fit large sheets (A3, A2, …). */
export const MIN_ZOOM = 0.01
export const MAX_ZOOM = 4000

const DEFAULT_ZOOM = 60

export function screenToWorld(vp: Viewport, p: Vec2): Vec2 {
  return {
    x: (p.x - vp.panPx.x) / vp.zoom,
    y: (vp.panPx.y - p.y) / vp.zoom,
  }
}

export function worldToScreen(vp: Viewport, p: Vec2): Vec2 {
  return {
    x: p.x * vp.zoom + vp.panPx.x,
    y: vp.panPx.y - p.y * vp.zoom,
  }
}

export function zoomAt(vp: Viewport, screenPoint: Vec2, zoomFactor: number): Viewport {
  const before = screenToWorld(vp, screenPoint)
  const nextZoom = clamp(vp.zoom * zoomFactor, MIN_ZOOM, MAX_ZOOM)
  const after = { x: before.x * nextZoom + vp.panPx.x, y: vp.panPx.y - before.y * nextZoom }
  return {
    zoom: nextZoom,
    panPx: {
      x: vp.panPx.x + (screenPoint.x - after.x),
      y: vp.panPx.y + (screenPoint.y - after.y),
    },
  }
}

export function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n))
}

export const ORIGIN_MARGIN_PX = 50

/** Pan offset that places world (0, 0) inset from the canvas bottom-left corner. */
export function panForBottomLeftOrigin(canvasHeight: number, margin = ORIGIN_MARGIN_PX): Vec2 {
  return { x: margin, y: canvasHeight - margin }
}

/** Adjust pan when the canvas height changes so the view stays anchored. */
export function panPxAfterCanvasHeightChange(panPx: Vec2, oldHeight: number, newHeight: number): Vec2 {
  return { x: panPx.x, y: panPx.y + (newHeight - oldHeight) }
}

export type FitExtentsOptions = {
  paddingPx?: number
  dimensionPaddingPx?: number
  defaultZoom?: number
}

/** Fit the viewport so all world bounds are visible inside the canvas. */
export function fitViewportToExtents(
  canvasWidth: number,
  canvasHeight: number,
  bounds: WorldBounds,
  showDimensions = false,
  options: FitExtentsOptions = {},
): Viewport {
  const padding = options.paddingPx ?? ORIGIN_MARGIN_PX
  const dimPad = showDimensions ? (options.dimensionPaddingPx ?? DIMENSION_MARGIN_PX + 24) : 0
  const edge = padding + dimPad

  const worldW = Math.max(bounds.x2 - bounds.x1, 1e-9)
  const worldH = Math.max(bounds.y2 - bounds.y1, 1e-9)

  const availW = Math.max(canvasWidth - edge * 2, 1)
  const availH = Math.max(canvasHeight - edge * 2, 1)

  const zoom = clamp(Math.min(availW / worldW, availH / worldH), MIN_ZOOM, MAX_ZOOM)

  const cx = (bounds.x1 + bounds.x2) / 2
  const cy = (bounds.y1 + bounds.y2) / 2
  const centerX = canvasWidth / 2
  const centerY = canvasHeight / 2

  return {
    zoom,
    panPx: {
      x: centerX - cx * zoom,
      y: centerY + cy * zoom,
    },
  }
}

export function defaultViewport(canvasHeight: number, zoom = DEFAULT_ZOOM): Viewport {
  return { zoom, panPx: panForBottomLeftOrigin(canvasHeight) }
}

