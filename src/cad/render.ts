import type { CadDoc, CadEntity, CadLayer, Units, Vec2, Viewport } from './types'
import { textFontCss } from './textFonts'
import { getEntityDimensions } from './dimensions'
import { rectFromAB } from './geometry'
import { effectiveRectFillet } from './rectFillet'
import { screenToWorld, worldToScreen } from './viewport'

function layerById(doc: CadDoc, id: string): CadLayer | undefined {
  return doc.layers.find((l) => l.id === id)
}

function w2s(vp: Viewport, p: Vec2): Vec2 {
  return worldToScreen(vp, p)
}

export function pickGridStepWorld(zoom: number, units: Units): number {
  const targetPx = 80
  const base = units === 'mm' ? 10 : 1
  let step = base
  while (step * zoom < targetPx / 4) step *= 2
  while (step * zoom > targetPx * 2) step /= 2
  return Math.max(step, units === 'mm' ? 1 : 0.1)
}

export type DrawSceneOptions = {
  preview: CadEntity | null
  transformPreview: CadEntity[] | null
  cursorWorld: Vec2 | null
  snapPoint: Vec2 | null
  marqueeScreen: { a: Vec2; b: Vec2; mode: 'window' | 'crossing' } | null
  showDimensions: boolean
}

export function drawScene(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  doc: CadDoc,
  options: DrawSceneOptions,
) {
  const { preview, transformPreview, cursorWorld, snapPoint, marqueeScreen, showDimensions } =
    options
  const { width, height } = ctx.canvas
  ctx.clearRect(0, 0, width, height)
  ctx.fillStyle = '#070910'
  ctx.fillRect(0, 0, width, height)

  drawGrid(ctx, vp, doc.units)
  drawAxes(ctx, vp)

  for (const e of doc.entities) {
    const layer = layerById(doc, e.layerId)
    if (!layer?.visible) continue
    const color = e.selected ? '#ffd166' : layer.color
    drawEntity(ctx, vp, e, color, false)
    if (showDimensions && (e.type === 'line' || e.type === 'rect' || e.type === 'circle')) {
      drawEntityDimensions(ctx, vp, e, doc.units)
    }
  }

  if (transformPreview) {
    for (const e of transformPreview) {
      const layer = layerById(doc, e.layerId)
      drawEntity(ctx, vp, e, layer?.color ?? '#63b3ff', true)
    }
  }

  if (preview) {
    const layer = layerById(doc, preview.layerId)
    drawEntity(ctx, vp, preview, layer?.color ?? '#63b3ff', true)
    if (showDimensions && (preview.type === 'line' || preview.type === 'rect' || preview.type === 'circle')) {
      drawEntityDimensions(ctx, vp, preview, doc.units, true)
    }
  }

  if (marqueeScreen) {
    drawMarquee(ctx, marqueeScreen)
  }

  if (snapPoint) {
    const s = w2s(vp, snapPoint)
    ctx.beginPath()
    ctx.strokeStyle = '#ffd166'
    ctx.lineWidth = 1.5
    ctx.arc(s.x, s.y, 6, 0, Math.PI * 2)
    ctx.stroke()
  }

  if (cursorWorld) {
    drawCursorReadout(ctx, cursorWorld, doc.units)
  }
}

function drawMarquee(
  ctx: CanvasRenderingContext2D,
  m: { a: Vec2; b: Vec2; mode: 'window' | 'crossing' },
) {
  const x = Math.min(m.a.x, m.b.x)
  const y = Math.min(m.a.y, m.b.y)
  const w = Math.abs(m.b.x - m.a.x)
  const h = Math.abs(m.b.y - m.a.y)
  ctx.save()
  if (m.mode === 'crossing') {
    ctx.strokeStyle = 'rgba(99, 210, 120, 0.95)'
    ctx.fillStyle = 'rgba(99, 210, 120, 0.1)'
    ctx.setLineDash([4, 3])
  } else {
    ctx.strokeStyle = 'rgba(99, 179, 255, 0.95)'
    ctx.fillStyle = 'rgba(99, 179, 255, 0.08)'
    ctx.setLineDash([])
  }
  ctx.lineWidth = 1
  ctx.fillRect(x, y, w, h)
  ctx.strokeRect(x, y, w, h)
  ctx.restore()
}

function drawGrid(ctx: CanvasRenderingContext2D, vp: Viewport, units: Units) {
  const step = pickGridStepWorld(vp.zoom, units)
  const minor = step / (units === 'mm' ? 10 : 4)

  const topLeft = screenToWorld(vp, { x: 0, y: 0 })
  const bottomRight = screenToWorld(vp, { x: ctx.canvas.width, y: ctx.canvas.height })

  const x0 = Math.floor(Math.min(topLeft.x, bottomRight.x) / minor) * minor
  const x1 = Math.ceil(Math.max(topLeft.x, bottomRight.x) / minor) * minor
  const y0 = Math.floor(Math.min(topLeft.y, bottomRight.y) / minor) * minor
  const y1 = Math.ceil(Math.max(topLeft.y, bottomRight.y) / minor) * minor

  ctx.lineWidth = 1
  for (let x = x0; x <= x1; x += minor) {
    const sx = w2s(vp, { x, y: 0 }).x
    const isMajor = Math.abs(x / step - Math.round(x / step)) < 1e-6
    ctx.strokeStyle = isMajor ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.05)'
    ctx.beginPath()
    ctx.moveTo(sx, 0)
    ctx.lineTo(sx, ctx.canvas.height)
    ctx.stroke()
  }
  for (let y = y0; y <= y1; y += minor) {
    const sy = w2s(vp, { x: 0, y }).y
    const isMajor = Math.abs(y / step - Math.round(y / step)) < 1e-6
    ctx.strokeStyle = isMajor ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.05)'
    ctx.beginPath()
    ctx.moveTo(0, sy)
    ctx.lineTo(ctx.canvas.width, sy)
    ctx.stroke()
  }
}

function drawAxes(ctx: CanvasRenderingContext2D, vp: Viewport) {
  const ox = w2s(vp, { x: 0, y: 0 }).x
  const oy = w2s(vp, { x: 0, y: 0 }).y
  ctx.strokeStyle = 'rgba(255,255,255,0.25)'
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.moveTo(ox, 0)
  ctx.lineTo(ox, ctx.canvas.height)
  ctx.moveTo(0, oy)
  ctx.lineTo(ctx.canvas.width, oy)
  ctx.stroke()
}

function drawRectPath(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  a: Vec2,
  b: Vec2,
  filletR?: number,
) {
  const bounds = rectFromAB(a, b)
  const r = effectiveRectFillet(bounds, filletR) * vp.zoom
  const { x1, y1, x2, y2 } = bounds
  const tl = w2s(vp, { x: x1, y: y2 })
  const tr = w2s(vp, { x: x2, y: y2 })
  const br = w2s(vp, { x: x2, y: y1 })
  const bl = w2s(vp, { x: x1, y: y1 })
  ctx.beginPath()
  if (r <= 1e-6) {
    ctx.moveTo(tl.x, tl.y)
    ctx.lineTo(tr.x, tr.y)
    ctx.lineTo(br.x, br.y)
    ctx.lineTo(bl.x, bl.y)
    ctx.closePath()
    return
  }
  ctx.moveTo(tl.x + r, tl.y)
  ctx.lineTo(tr.x - r, tr.y)
  ctx.arcTo(tr.x, tr.y, tr.x, tr.y + r, r)
  ctx.lineTo(br.x, br.y - r)
  ctx.arcTo(br.x, br.y, br.x - r, br.y, r)
  ctx.lineTo(bl.x + r, bl.y)
  ctx.arcTo(bl.x, bl.y, bl.x, bl.y - r, r)
  ctx.lineTo(tl.x, tl.y + r)
  ctx.arcTo(tl.x, tl.y, tl.x + r, tl.y, r)
  ctx.closePath()
}

function drawEntity(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  e: CadEntity,
  color: string,
  dashed: boolean,
) {
  ctx.strokeStyle = color
  ctx.fillStyle = color
  ctx.lineWidth = e.selected ? 2.5 : 2
  if (dashed) ctx.setLineDash([6, 4])
  else ctx.setLineDash([])

  switch (e.type) {
    case 'line': {
      const a = w2s(vp, e.a)
      const b = w2s(vp, e.b)
      ctx.beginPath()
      ctx.moveTo(a.x, a.y)
      ctx.lineTo(b.x, b.y)
      if (e.filletArc) {
        const corner = w2s(vp, e.filletArc.corner)
        const through = w2s(vp, e.filletArc.through)
        ctx.arcTo(
          corner.x,
          corner.y,
          through.x,
          through.y,
          e.filletArc.r * vp.zoom,
        )
      }
      ctx.stroke()
      break
    }
    case 'rect': {
      drawRectPath(ctx, vp, e.a, e.b, e.filletR)
      ctx.stroke()
      break
    }
    case 'circle': {
      const c = w2s(vp, e.c)
      ctx.beginPath()
      ctx.arc(c.x, c.y, e.r * vp.zoom, 0, Math.PI * 2)
      ctx.stroke()
      if (dashed) {
        ctx.setLineDash([])
        ctx.beginPath()
        ctx.arc(c.x, c.y, 3, 0, Math.PI * 2)
        ctx.fill()
      }
      break
    }
    case 'arc': {
      const c = w2s(vp, e.c)
      const r = e.r * vp.zoom
      const toScreenRad = (deg: number) => {
        const rad = (deg * Math.PI) / 180
        const sp = w2s(vp, {
          x: e.c.x + e.r * Math.cos(rad),
          y: e.c.y + e.r * Math.sin(rad),
        })
        return Math.atan2(sp.y - c.y, sp.x - c.x)
      }
      const startRad = toScreenRad(e.startDeg)
      const endRad = toScreenRad(e.endDeg)
      const start = {
        x: c.x + r * Math.cos(startRad),
        y: c.y + r * Math.sin(startRad),
      }
      ctx.beginPath()
      ctx.moveTo(start.x, start.y)
      let ccwSweep = endRad - startRad
      while (ccwSweep < 0) ccwSweep += Math.PI * 2
      while (ccwSweep >= Math.PI * 2) ccwSweep -= Math.PI * 2
      ctx.arc(c.x, c.y, r, startRad, endRad, ccwSweep > Math.PI)
      ctx.stroke()
      break
    }
    case 'text': {
      const p = w2s(vp, e.p)
      const px = e.height * vp.zoom
      ctx.font = `${px}px ${textFontCss(e.fontFamily)}`
      ctx.textBaseline = 'bottom'
      if (e.rotationDeg) {
        ctx.save()
        ctx.translate(p.x, p.y)
        ctx.rotate((-e.rotationDeg * Math.PI) / 180)
        ctx.fillText(e.text, 0, 0)
        ctx.restore()
      } else {
        ctx.fillText(e.text, p.x, p.y)
      }
      break
    }
  }
  ctx.setLineDash([])
}

function drawEntityDimensions(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  e: CadEntity,
  units: Units,
  preview = false,
) {
  const labels = getEntityDimensions(e, units, vp)
  ctx.font = '11px ui-monospace, monospace'
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'center'

  for (const label of labels) {
    const anchor = w2s(vp, label.anchor)
    const s = { x: anchor.x + label.screenOffset.x, y: anchor.y + label.screenOffset.y }
    ctx.save()
    ctx.fillStyle = preview ? 'rgba(99, 179, 255, 0.9)' : 'rgba(255, 255, 255, 0.85)'
    if (label.orientation === 'vertical') {
      ctx.translate(s.x, s.y)
      ctx.rotate(-Math.PI / 2)
      ctx.fillText(label.text, 0, 0)
    } else {
      ctx.fillText(label.text, s.x, s.y)
    }
    ctx.restore()
  }

  if (e.type === 'line') {
    drawLinearDimensionGuides(ctx, vp, e.a, e.b)
  } else if (e.type === 'rect') {
    const r = rectFromAB(e.a, e.b)
    drawLinearDimensionGuides(ctx, vp, { x: r.x1, y: r.y1 }, { x: r.x2, y: r.y1 })
    drawLinearDimensionGuides(ctx, vp, { x: r.x2, y: r.y1 }, { x: r.x2, y: r.y2 })
  } else if (e.type === 'circle') {
    const c = w2s(vp, e.c)
    const edge = w2s(vp, { x: e.c.x + e.r, y: e.c.y })
    ctx.strokeStyle = preview ? 'rgba(99, 179, 255, 0.5)' : 'rgba(255, 255, 255, 0.35)'
    ctx.lineWidth = 1
    ctx.setLineDash([3, 3])
    ctx.beginPath()
    ctx.moveTo(c.x, c.y)
    ctx.lineTo(edge.x, edge.y)
    ctx.stroke()
    ctx.setLineDash([])
  }
}

function drawLinearDimensionGuides(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  a: Vec2,
  b: Vec2,
) {
  const sa = w2s(vp, a)
  const sb = w2s(vp, b)
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)'
  ctx.lineWidth = 1
  ctx.setLineDash([2, 2])
  ctx.beginPath()
  ctx.moveTo(sa.x, sa.y)
  ctx.lineTo(sb.x, sb.y)
  ctx.stroke()
  ctx.setLineDash([])
}

function drawCursorReadout(ctx: CanvasRenderingContext2D, p: Vec2, units: Units) {
  const label = `X ${p.x.toFixed(2)}  Y ${p.y.toFixed(2)} ${units}`
  ctx.font = '12px ui-monospace, monospace'
  const pad = 8
  const tw = ctx.measureText(label).width
  ctx.fillStyle = 'rgba(16,20,33,0.85)'
  ctx.strokeStyle = 'rgba(255,255,255,0.12)'
  ctx.lineWidth = 1
  const x = ctx.canvas.width - tw - pad * 2 - 10
  const y = 10
  ctx.fillRect(x, y, tw + pad * 2, 22)
  ctx.strokeRect(x, y, tw + pad * 2, 22)
  ctx.fillStyle = 'rgba(255,255,255,0.75)'
  ctx.fillText(label, x + pad, y + 16)
}
