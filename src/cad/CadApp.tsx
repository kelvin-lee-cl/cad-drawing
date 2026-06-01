import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { SaveLogEntry } from '../firebase/projectService'
import type { CadDoc, CadEntity, LineEntity, RectEntity, Tool, Vec2, Viewport } from './types'
import {
  DIM_FIELDS_BY_KIND,
  dimFieldLabel,
  type DimField,
  type DraftKind,
  type LockedDims,
  parseDimValue,
  parseFilletRadius,
  parseRotationAngle,
  parseScaleRatio,
  parseSignedDistance,
  previewEndFromDraft,
} from './dimensionInput'
import {
  cloneEntity,
  filletTwoLines,
  filletRadiusRange,
  offsetEntity,
  rotateEntity,
  scaleEntity,
  translateEntity,
} from './entityEdit'
import { boundsFromEntities } from './bounds'
import { applyRectFillet, rectFilletRadiusRange } from './rectFillet'
import { applyTrimByRect } from './trimRect'
import { cloneDoc, MAX_UNDO_STEPS } from './history'
import { newId } from './id'
import { createEmptyDoc } from './serialize'
import { DEFAULT_TEXT_FONT, defaultTextHeight, TEXT_FONT_OPTIONS } from './textFonts'
import { dist, snapOrtho, sub } from './geometry'
import { drawScene, pickGridStepWorld } from './render'
import { selectEntitiesInBox, worldBoxFromCorners } from './selection'
import { snapPoint, type SnapSettings } from './snap'
import {
  defaultViewport,
  fitViewportToExtents,
  panForBottomLeftOrigin,
  panPxAfterCanvasHeightChange,
  screenToWorld,
  worldToScreen,
  zoomAt,
} from './viewport'

const DRAW_TOOLS: Tool[] = ['select', 'pan', 'line', 'rect', 'circle', 'text']
const MODIFY_TOOLS: Tool[] = ['move', 'rotate', 'scale', 'trim', 'fillet', 'offset']
const SELECTION_MODIFY_TOOLS: Tool[] = ['move', 'rotate', 'scale', 'offset', 'fillet']

const TOOL_LABELS: Record<Tool, string> = {
  select: 'Select',
  move: 'Move',
  rotate: 'Rotate',
  scale: 'Scale',
  trim: 'Trim',
  fillet: 'Fillet',
  offset: 'Offset',
  pan: 'Pan',
  line: 'Line',
  rect: 'Rectangle',
  circle: 'Circle',
  text: 'Text',
}
const MARQUEE_MIN_PX = 4

function makeDefaultDoc(): CadDoc {
  return createEmptyDoc()
}

export type CadAppProps = {
  readOnly?: boolean
  loadedDoc?: CadDoc | null
  loadedDocKey?: number
  userLabel?: string
  onSignOut?: () => void
  canEdit?: boolean
  lockHolder?: string
  onSave?: (doc: CadDoc) => void | Promise<void>
  saving?: boolean
  saveError?: string | null
  lastSavedMessage?: string | null
  lastSavedBy?: string
  saveLogs?: SaveLogEntry[]
  onDeleteSaveLog?: (logId: string) => void | Promise<void>
  onClearSaveLogs?: () => void | Promise<void>
}

function formatLogTime(date: Date): string {
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

type Draft =
  | { kind: 'line'; start: Vec2 }
  | { kind: 'rect'; start: Vec2 }
  | { kind: 'circle'; center: Vec2 }
  | null

type TextPlacement = { p: Vec2 } | null

type DimInputState = {
  activeIndex: number
  values: Partial<Record<DimField, string>>
  locked: LockedDims
}

type EditSession =
  | { kind: 'move'; from: Vec2 }
  | { kind: 'scale'; base: Vec2 }
  | { kind: 'rotate'; base: Vec2 }

const EMPTY_DIM_INPUT: DimInputState = { activeIndex: -1, values: {}, locked: {} }

function squareMarqueeCorner(start: Vec2, end: Vec2): Vec2 {
  const w = Math.abs(end.x - start.x)
  const h = Math.abs(end.y - start.y)
  const s = Math.max(w, h)
  return {
    x: start.x + (end.x >= start.x ? s : -s),
    y: start.y + (end.y >= start.y ? s : -s),
  }
}

function effectiveLocked(values: Partial<Record<DimField, string>>, locked: LockedDims): LockedDims {
  return {
    length: locked.length ?? parseDimValue(values.length ?? '') ?? undefined,
    width: locked.width ?? parseDimValue(values.width ?? '') ?? undefined,
    height: locked.height ?? parseDimValue(values.height ?? '') ?? undefined,
    radius: locked.radius ?? parseDimValue(values.radius ?? '') ?? undefined,
  }
}

export function CadApp({
  readOnly = false,
  loadedDoc,
  loadedDocKey,
  userLabel,
  onSignOut,
  canEdit = true,
  lockHolder,
  onSave,
  saving = false,
  saveError,
  lastSavedMessage,
  lastSavedBy,
  saveLogs = [],
  onDeleteSaveLog,
  onClearSaveLogs,
}: CadAppProps = {}) {
  const readOnlyRef = useRef(readOnly)
  readOnlyRef.current = readOnly

  const [doc, setDoc] = useState<CadDoc>(() => loadedDoc ?? makeDefaultDoc())
  const [tool, setTool] = useState<Tool>('line')
  const [viewport, setViewport] = useState<Viewport>(() => ({
    panPx: { x: 0, y: 0 },
    zoom: 60,
  }))
  const [draft, setDraft] = useState<Draft>(null)
  const [previewEnd, setPreviewEnd] = useState<Vec2 | null>(null)
  const [cursorWorld, setCursorWorld] = useState<Vec2 | null>(null)
  const [snapIndicator, setSnapIndicator] = useState<Vec2 | null>(null)
  const [marqueeScreen, setMarqueeScreen] = useState<{
    a: Vec2
    b: Vec2
    mode: 'window' | 'crossing'
  } | null>(null)
  const [dimInput, setDimInput] = useState<DimInputState>(EMPTY_DIM_INPUT)
  const [ortho, setOrtho] = useState(false)
  const [snapEndpoints, setSnapEndpoints] = useState(true)
  const [snapCenter, setSnapCenter] = useState(true)
  const [showDimensions, setShowDimensions] = useState(true)
  const [zoomExtents, setZoomExtents] = useState(false)
  const [textPlacement, setTextPlacement] = useState<TextPlacement>(null)
  const [textInput, setTextInput] = useState('Label')
  const [textHeight, setTextHeight] = useState(1)
  const [textFontFamily, setTextFontFamily] = useState<string>(DEFAULT_TEXT_FONT)
  const [editSession, setEditSession] = useState<EditSession | null>(null)
  const [modifyInput, setModifyInput] = useState('')
  const [editingLayerId, setEditingLayerId] = useState<string | null>(null)
  const [editingLayerName, setEditingLayerName] = useState('')

  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const layerColorInputRef = useRef<HTMLInputElement | null>(null)
  const layerColorPickIdRef = useRef<string | null>(null)
  const wrapRef = useRef<HTMLElement | null>(null)
  const viewportRef = useRef(viewport)
  viewportRef.current = viewport
  const redrawRafRef = useRef(0)
  const viewportSyncTimerRef = useRef(0)
  const zoomExtentsRef = useRef(zoomExtents)
  zoomExtentsRef.current = zoomExtents
  const originAnchoredRef = useRef(false)
  const panRef = useRef<{ active: boolean; last: Vec2 }>({ active: false, last: { x: 0, y: 0 } })
  const selectRef = useRef<{ active: boolean; start: Vec2 } | null>(null)
  const trimRef = useRef<{ active: boolean; start: Vec2 } | null>(null)
  const shiftRef = useRef(false)
  const dimInputRefs = useRef<Record<DimField, HTMLInputElement | null>>({
    length: null,
    width: null,
    height: null,
    radius: null,
  })
  const modifyInputRef = useRef<HTMLInputElement | null>(null)
  const clipboardRef = useRef<CadEntity[]>([])
  const docRef = useRef(doc)
  docRef.current = doc
  const undoStackRef = useRef<CadDoc[]>([])
  const redoStackRef = useRef<CadDoc[]>([])

  useEffect(() => {
    if (loadedDoc == null || loadedDocKey == null) return
    const next = structuredClone(loadedDoc)
    setDoc({
      ...next,
      entities: next.entities.map((entity) => ({ ...entity, selected: false })),
    })
    undoStackRef.current = []
    redoStackRef.current = []
    setDraft(null)
    setPreviewEnd(null)
    setTextPlacement(null)
    setEditSession(null)
  }, [loadedDocKey, loadedDoc])

  useEffect(() => {
    if (readOnly && tool !== 'select' && tool !== 'pan') {
      setTool('select')
    }
  }, [readOnly, tool])

  const pushUndoSnapshot = useCallback(() => {
    undoStackRef.current.push(cloneDoc(docRef.current))
    if (undoStackRef.current.length > MAX_UNDO_STEPS) undoStackRef.current.shift()
    redoStackRef.current = []
  }, [])

  const commitDoc = useCallback(
    (updater: (d: CadDoc) => CadDoc) => {
      if (readOnlyRef.current) return
      pushUndoSnapshot()
      setDoc(updater)
    },
    [pushUndoSnapshot],
  )

  const undo = useCallback(() => {
    const prev = undoStackRef.current.pop()
    if (!prev) return
    redoStackRef.current.push(cloneDoc(docRef.current))
    setDoc(prev)
  }, [])

  const redo = useCallback(() => {
    const next = redoStackRef.current.pop()
    if (!next) return
    undoStackRef.current.push(cloneDoc(docRef.current))
    setDoc(next)
  }, [])

  const resolveDefaultTextHeight = useCallback(() => {
    const canvas = canvasRef.current
    const h = canvas?.clientHeight ?? 600
    return defaultTextHeight(viewportRef.current.zoom, h)
  }, [])

  const gridSize = pickGridStepWorld(viewportRef.current.zoom, doc.units)
  const snapSettings: SnapSettings = {
    enabled: snapEndpoints || snapCenter,
    endpoint: snapEndpoints,
    center: snapCenter,
    grid: false,
    gridSizeWorld: gridSize,
    thresholdPx: 12,
  }

  const draftKind = draft?.kind ?? null

  const resetDimInput = useCallback(() => setDimInput(EMPTY_DIM_INPUT), [])

  const focusDimField = useCallback((field: DimField) => {
    requestAnimationFrame(() => dimInputRefs.current[field]?.focus())
  }, [])

  const shouldApplyOrtho = useCallback(
    (forTool: Tool, activeDraft: Draft) => {
      if (forTool === 'rect') return false
      if (activeDraft?.kind === 'rect') return false
      return ortho || shiftRef.current
    },
    [ortho],
  )

  const resolvePoint = useCallback(
    (pWorld: Vec2, start?: Vec2, forTool: Tool = tool, activeDraft: Draft = draft): Vec2 => {
      const snapped = snapPoint(viewportRef.current, pWorld, doc.entities, snapSettings)
      let p = snapped.world
      if (shouldApplyOrtho(forTool, activeDraft) && start) p = snapOrtho(start, p)
      return p
    },
    [doc.entities, snapSettings, shouldApplyOrtho, tool, draft],
  )

  const applyDimsToCursor = useCallback(
    (kind: DraftKind, anchor: Vec2, cursor: Vec2, dim: DimInputState): Vec2 => {
      const locked = effectiveLocked(dim.values, dim.locked)
      return previewEndFromDraft(kind, anchor, cursor, locked)
    },
    [],
  )

  const updatePreviewFromCursor = useCallback(
    (cursor: Vec2) => {
      if (!draft) return
      const anchor = draft.kind === 'circle' ? draft.center : draft.start
      const end = applyDimsToCursor(draft.kind, anchor, cursor, dimInput)
      setPreviewEnd(end)
    },
    [draft, dimInput, applyDimsToCursor],
  )

  const makePreview = useCallback((): CadEntity | null => {
    if (!previewEnd || !draft) return null
    const layerId = doc.activeLayerId
    if (draft.kind === 'line') {
      return { id: 'preview', type: 'line', layerId, a: draft.start, b: previewEnd }
    }
    if (draft.kind === 'rect') {
      return { id: 'preview', type: 'rect', layerId, a: draft.start, b: previewEnd }
    }
    if (draft.kind === 'circle') {
      const r = dist(draft.center, previewEnd)
      return { id: 'preview', type: 'circle', layerId, c: draft.center, r }
    }
    return null
  }, [draft, previewEnd, doc.activeLayerId])

  const scenePreview = useMemo((): CadEntity | null => {
    const drawPreview = makePreview()
    if (drawPreview) return drawPreview
    if (!textPlacement) return null
    const trimmed = textInput.trim()
    if (!trimmed) return null
    return {
      id: 'preview',
      type: 'text',
      layerId: doc.activeLayerId,
      p: textPlacement.p,
      text: trimmed,
      height: textHeight,
      fontFamily: textFontFamily,
    }
  }, [makePreview, textPlacement, textInput, textHeight, textFontFamily, doc.activeLayerId])

  const addEntity = useCallback(
    (entity: CadEntity) => {
      commitDoc((d) => ({ ...d, entities: [...d.entities, entity] }))
    },
    [commitDoc],
  )

  const commitLine = (start: Vec2, end: Vec2) => {
    if (dist(start, end) < 1e-6) return
    addEntity({ id: newId('line'), type: 'line', layerId: doc.activeLayerId, a: start, b: end })
  }

  const commitRect = (start: Vec2, end: Vec2) => {
    const dx = Math.abs(end.x - start.x)
    const dy = Math.abs(end.y - start.y)
    if (dx < 1e-6 && dy < 1e-6) return
    addEntity({ id: newId('rect'), type: 'rect', layerId: doc.activeLayerId, a: start, b: end })
  }

  const commitCircle = (center: Vec2, edge: Vec2) => {
    const r = dist(center, edge)
    if (r < 1e-6) return
    addEntity({ id: newId('circle'), type: 'circle', layerId: doc.activeLayerId, c: center, r })
  }

  const commitText = (p: Vec2, text: string, height: number, fontFamily: string) => {
    const trimmed = text.trim()
    if (!trimmed) return
    addEntity({
      id: newId('text'),
      type: 'text',
      layerId: doc.activeLayerId,
      p,
      text: trimmed,
      height,
      fontFamily,
    })
  }

  const cancelDraft = useCallback(() => {
    setDraft(null)
    setPreviewEnd(null)
    resetDimInput()
  }, [resetDimInput])

  const applyDimField = useCallback(
    (field: DimField): boolean => {
      if (!draft || !draftKind) return false
      const val = parseDimValue(dimInput.values[field] ?? '')
      if (val == null) return false

      if (draft.kind === 'rect') {
        if (field === 'width') {
          setDimInput((prev) => ({
            ...prev,
            locked: { ...prev.locked, width: val },
            activeIndex: 1,
          }))
          focusDimField('height')
          if (cursorWorld) {
            const end = previewEndFromDraft('rect', draft.start, cursorWorld, {
              ...dimInput.locked,
              width: val,
              height: dimInput.locked.height ?? parseDimValue(dimInput.values.height ?? '') ?? undefined,
            })
            setPreviewEnd(end)
          }
          return false
        }
        if (field === 'height') {
          const locked: LockedDims = { ...dimInput.locked, height: val }
          const end = previewEndFromDraft(
            'rect',
            draft.start,
            cursorWorld ?? draft.start,
            locked,
          )
          commitRect(draft.start, end)
          setDraft(null)
          setPreviewEnd(null)
          resetDimInput()
          return true
        }
      }

      if (draft.kind === 'line' && field === 'length') {
        const end = previewEndFromDraft('line', draft.start, cursorWorld ?? draft.start, { length: val })
        commitLine(draft.start, end)
        setDraft(null)
        setPreviewEnd(null)
        resetDimInput()
        return true
      }

      if (draft.kind === 'circle' && field === 'radius') {
        const end = previewEndFromDraft('circle', draft.center, cursorWorld ?? draft.center, {
          radius: val,
        })
        commitCircle(draft.center, end)
        setDraft(null)
        setPreviewEnd(null)
        resetDimInput()
        return true
      }

      return false
    },
    [draft, draftKind, dimInput, cursorWorld, focusDimField, resetDimInput, doc.activeLayerId, addEntity],
  )

  const clearSelection = useCallback(() => {
    setDoc((d) => ({
      ...d,
      entities: d.entities.map((e) => ({ ...e, selected: false })),
    }))
  }, [])

  const clearEditSession = useCallback(() => setEditSession(null), [])

  const selectedEntities = useMemo(
    () => doc.entities.filter((e) => e.selected),
    [doc.entities],
  )
  const selectedCount = selectedEntities.length
  const selectedLines = useMemo(
    () => selectedEntities.filter((e): e is LineEntity => e.type === 'line'),
    [selectedEntities],
  )
  const selectedRects = useMemo(
    () => selectedEntities.filter((e): e is RectEntity => e.type === 'rect'),
    [selectedEntities],
  )
  const offsettableSelected = useMemo(
    () =>
      selectedEntities.filter(
        (e) => e.type === 'line' || e.type === 'circle' || e.type === 'rect',
      ),
    [selectedEntities],
  )
  const filletTarget = useMemo(() => {
    if (selectedLines.length === 2 && selectedCount === 2) {
      const range = filletRadiusRange(selectedLines[0], selectedLines[1])
      if (range) return { kind: 'lines' as const, range, lines: selectedLines }
    }
    if (selectedRects.length === 1 && selectedCount === 1) {
      const range = rectFilletRadiusRange(selectedRects[0].a, selectedRects[0].b)
      if (range) return { kind: 'rect' as const, range, rect: selectedRects[0] }
    }
    return null
  }, [selectedLines, selectedRects, selectedCount])
  const filletRange = filletTarget?.range ?? null

  const deleteSelected = useCallback(() => {
    commitDoc((d) => ({ ...d, entities: d.entities.filter((e) => !e.selected) }))
  }, [commitDoc])

  const applyTranslate = useCallback(
    (delta: Vec2) => {
      commitDoc((d) => {
        const selected = d.entities.filter((e) => e.selected)
        if (!selected.length) return d
        return {
          ...d,
          entities: d.entities.map((e) => (e.selected ? translateEntity(e, delta) : e)),
        }
      })
    },
    [commitDoc],
  )

  const copySelectionToClipboard = useCallback(() => {
    const selected = doc.entities.filter((e) => e.selected)
    if (!selected.length) return
    clipboardRef.current = selected.map((e) => ({ ...e, selected: false }))
  }, [doc.entities])

  const pasteFromClipboard = useCallback(() => {
    if (!clipboardRef.current.length) return
    commitDoc((d) => {
      const pasted = clipboardRef.current.map((e) => ({
        ...cloneEntity(e, d.activeLayerId),
        selected: true,
      }))
      return {
        ...d,
        entities: [
          ...d.entities.map((e) => ({ ...e, selected: false })),
          ...pasted,
        ],
      }
    })
  }, [commitDoc])

  const applyScaleRatio = useCallback(
    (ratio: number) => {
      if (!editSession || editSession.kind !== 'scale') return
      const base = editSession.base
      commitDoc((d) => ({
        ...d,
        entities: d.entities.map((e) => (e.selected ? scaleEntity(e, base, ratio) : e)),
      }))
      clearEditSession()
      setModifyInput('')
      setTool('select')
    },
    [editSession, clearEditSession, commitDoc],
  )

  const applyRotateAngle = useCallback(
    (angleDeg: number) => {
      if (!editSession || editSession.kind !== 'rotate') return
      const base = editSession.base
      commitDoc((d) => ({
        ...d,
        entities: d.entities.map((e) => (e.selected ? rotateEntity(e, base, angleDeg) : e)),
      }))
      clearEditSession()
      setModifyInput('')
      setTool('select')
    },
    [editSession, clearEditSession, commitDoc],
  )

  const applyOffsetDistance = useCallback(
    (distance: number) => {
      commitDoc((d) => {
        const selected = d.entities.filter(
          (e) =>
            e.selected &&
            (e.type === 'line' || e.type === 'circle' || e.type === 'rect'),
        )
        if (!selected.length) return d

        const added = selected.flatMap((e) => {
          const offset = offsetEntity(e, distance)
          return offset ? [cloneEntity(offset, d.activeLayerId)] : []
        })

        return {
          ...d,
          entities: [
            ...d.entities.map((e) => ({ ...e, selected: false })),
            ...added,
          ],
        }
      })
      setModifyInput('')
      setTool('select')
    },
    [commitDoc],
  )

  const applyFillet = useCallback(
    (radius: number) => {
      if (!filletTarget) return
      if (filletTarget.kind === 'lines') {
        const [lA, lB] = filletTarget.lines
        const result = filletTwoLines(lA, lB, radius)
        if (!result) return
        commitDoc((d) => ({
          ...d,
          entities: [
            ...d.entities.filter((e) => e.id !== lA.id && e.id !== lB.id),
            ...result,
          ],
        }))
      } else {
        const updated = applyRectFillet(filletTarget.rect, radius)
        if (!updated) return
        commitDoc((d) => ({
          ...d,
          entities: d.entities.map((e) => (e.id === updated.id ? updated : e)),
        }))
      }
      setModifyInput('')
      setTool('select')
    },
    [filletTarget, commitDoc],
  )

  const submitModifyInput = useCallback(() => {
    if (tool === 'fillet') {
      if (!filletRange) return
      const radius = parseFilletRadius(modifyInput, filletRange.min, filletRange.max)
      if (radius != null) applyFillet(radius)
      return
    }
    if (tool === 'offset') {
      const distance = parseSignedDistance(modifyInput)
      if (distance != null) applyOffsetDistance(distance)
      return
    }
    if (tool === 'scale') {
      const ratio = parseScaleRatio(modifyInput)
      if (ratio != null) applyScaleRatio(ratio)
      return
    }
    if (tool === 'rotate') {
      const angle = parseRotationAngle(modifyInput)
      if (angle != null) applyRotateAngle(angle)
    }
  }, [tool, modifyInput, filletRange, applyFillet, applyOffsetDistance, applyScaleRatio, applyRotateAngle])

  useEffect(() => {
    if (tool !== 'fillet' || !filletRange) return
    setModifyInput(((filletRange.min + filletRange.max) / 2).toFixed(2))
  }, [tool, filletRange])

  const filletRadiusValue = useMemo(() => {
    if (!filletRange) return null
    const parsed = Number.parseFloat(modifyInput)
    if (Number.isFinite(parsed)) {
      return Math.max(filletRange.min, Math.min(filletRange.max, parsed))
    }
    return (filletRange.min + filletRange.max) / 2
  }, [modifyInput, filletRange])

  const activateTool = useCallback(
    (next: Tool) => {
      if (readOnly && next !== 'select' && next !== 'pan') return
      setTool(next)
      cancelDraft()
      setTextPlacement(null)
      setModifyInput('')
      selectRef.current = null
      trimRef.current = null
      setMarqueeScreen(null)
      clearEditSession()
      if (next === 'fillet' || next === 'offset' || next === 'rotate') {
        requestAnimationFrame(() => modifyInputRef.current?.focus())
      }
    },
    [cancelDraft, clearEditSession, deleteSelected, readOnly, selectedCount],
  )

  const finishMarqueeSelect = useCallback(
    (startScreen: Vec2, endScreen: Vec2) => {
      const w = Math.abs(endScreen.x - startScreen.x)
      const h = Math.abs(endScreen.y - startScreen.y)
      if (w < MARQUEE_MIN_PX && h < MARQUEE_MIN_PX) {
        clearSelection()
        return
      }
      const crossing = endScreen.x < startScreen.x
      const box = worldBoxFromCorners(
        screenToWorld(viewportRef.current, startScreen),
        screenToWorld(viewportRef.current, endScreen),
      )
      setDoc((d) => ({
        ...d,
        entities: selectEntitiesInBox(d.entities, box, crossing ? 'crossing' : 'window'),
      }))
    },
    [clearSelection],
  )

  const finishTrimMarquee = useCallback(
    (startScreen: Vec2, endScreen: Vec2) => {
      const end = shiftRef.current ? squareMarqueeCorner(startScreen, endScreen) : endScreen
      const w = Math.abs(end.x - startScreen.x)
      const h = Math.abs(end.y - startScreen.y)
      if (w < MARQUEE_MIN_PX && h < MARQUEE_MIN_PX) return
      const box = worldBoxFromCorners(
        screenToWorld(viewportRef.current, startScreen),
        screenToWorld(viewportRef.current, end),
      )
      commitDoc((d) => ({ ...d, entities: applyTrimByRect(d.entities, box) }))
    },
    [commitDoc],
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      shiftRef.current = e.shiftKey

      const target = e.target as HTMLElement
      const inTextField = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA'

      if (e.key === 'Escape') {
        cancelDraft()
        setTextPlacement(null)
        setModifyInput('')
        selectRef.current = null
        trimRef.current = null
        setMarqueeScreen(null)
        clearEditSession()
        clearSelection()
        return
      }

      if (readOnlyRef.current && !inTextField) {
        if (e.key === 'Delete' || e.key === 'Backspace') return
        const cmdOrCtrl = e.metaKey || e.ctrlKey
        if (cmdOrCtrl && (e.key === 'v' || e.key === 'z' || e.key === 'y')) return
      }

      if ((e.key === 'Delete' || e.key === 'Backspace') && !inTextField) {
        if (selectedCount > 0) {
          e.preventDefault()
          deleteSelected()
        }
        return
      }

      const cmdOrCtrl = e.metaKey || e.ctrlKey
      if (cmdOrCtrl && e.key === 'c' && !inTextField) {
        if (selectedCount > 0) {
          e.preventDefault()
          copySelectionToClipboard()
        }
        return
      }
      if (cmdOrCtrl && e.key === 'v' && !inTextField) {
        if (clipboardRef.current.length > 0) {
          e.preventDefault()
          pasteFromClipboard()
        }
        return
      }
      if (cmdOrCtrl && e.key === 'z' && !inTextField) {
        e.preventDefault()
        if (e.shiftKey) redo()
        else undo()
        return
      }
      if (cmdOrCtrl && e.key === 'y' && !inTextField) {
        e.preventDefault()
        redo()
        return
      }

      if (
        (tool === 'fillet' || tool === 'offset' || tool === 'scale' || tool === 'rotate') &&
        !inTextField &&
        e.key === 'Enter'
      ) {
        e.preventDefault()
        submitModifyInput()
        return
      }

      if (!draft || !draftKind || inTextField) return

      if (e.key === 'Tab') {
        e.preventDefault()
        const fields = DIM_FIELDS_BY_KIND[draftKind]
        setDimInput((prev) => {
          const nextIndex = prev.activeIndex < 0 ? 0 : prev.activeIndex
          requestAnimationFrame(() => dimInputRefs.current[fields[nextIndex]]?.focus())
          return { ...prev, activeIndex: nextIndex }
        })
        return
      }

      if (e.key === 'Enter' && dimInput.activeIndex >= 0) {
        e.preventDefault()
        const fields = DIM_FIELDS_BY_KIND[draftKind]
        const field = fields[dimInput.activeIndex]
        applyDimField(field)
      }
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keyup', onKey)
    }
  }, [
    cancelDraft,
    clearEditSession,
    clearSelection,
    deleteSelected,
    draft,
    draftKind,
    dimInput.activeIndex,
    applyDimField,
    focusDimField,
    copySelectionToClipboard,
    pasteFromClipboard,
    undo,
    redo,
    selectedCount,
    submitModifyInput,
    tool,
  ])

  const transformPreview = useMemo(() => {
    if (!editSession) return null
    if (editSession.kind === 'scale') {
      const ratio = parseScaleRatio(modifyInput)
      if (ratio == null) return null
      return selectedEntities.map((e) => scaleEntity(e, editSession.base, ratio))
    }
    if (editSession.kind === 'rotate') {
      const angle = parseRotationAngle(modifyInput)
      if (angle == null) return null
      return selectedEntities.map((e) => rotateEntity(e, editSession.base, angle))
    }
    if (editSession.kind !== 'move') return null
    if (!cursorWorld) return null
    const delta = sub(cursorWorld, editSession.from)
    return selectedEntities.map((e) => translateEntity(e, delta))
  }, [editSession, cursorWorld, selectedEntities, modifyInput])

  const modifyHint = useMemo(() => {
    if (tool === 'move') {
      if (!selectedCount) return 'Select objects first, then pick a base point.'
      if (!editSession || editSession.kind !== tool) {
        return `${TOOL_LABELS[tool]}: click base point, then destination.`
      }
      return `${TOOL_LABELS[tool]}: click destination.`
    }
    if (tool === 'rotate') {
      if (!selectedCount) return 'Select objects first, then pick a base point.'
      if (!editSession || editSession.kind !== 'rotate') {
        return 'Rotate: click base point, then enter angle (clockwise, degrees).'
      }
      return 'Rotate: enter angle and press Enter (positive = clockwise).'
    }
    if (tool === 'scale') {
      if (!selectedCount) return 'Select objects first, then pick a base point.'
      if (!editSession || editSession.kind !== 'scale') {
        return 'Scale: click base point, then enter ratio (e.g. 2 = double, 0.5 = half).'
      }
      return 'Scale: enter ratio and press Enter (e.g. 2 = double, 0.5 = half).'
    }
    if (tool === 'offset') {
      return offsettableSelected.length
        ? 'Offset: enter distance, then press Enter. Creates a copy; original stays. Negative value reverses direction.'
        : 'Select lines, circles, or rectangles first.'
    }
    if (tool === 'trim') {
      return 'Trim: drag a rectangle (Shift = square). Removes line parts inside the box and cuts to other objects.'
    }
    if (tool === 'fillet') {
      if (!filletTarget) {
        return 'Select exactly two lines, or one rectangle, then set corner radius.'
      }
      if (filletTarget.kind === 'lines' && !filletRange) {
        return 'Selected lines must intersect at an angle.'
      }
      return `Fillet: radius must be between ${filletRange!.min.toFixed(2)} and ${filletRange!.max.toFixed(2)} ${doc.units}.`
    }
    return null
  }, [tool, editSession, selectedCount, filletTarget, offsettableSelected.length, filletRange, doc.units])

  const redrawCanvas = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    drawScene(ctx, viewportRef.current, doc, {
      preview: scenePreview,
      transformPreview,
      cursorWorld,
      snapPoint: snapIndicator,
      marqueeScreen,
      showDimensions,
    })
  }, [
    doc,
    scenePreview,
    transformPreview,
    cursorWorld,
    snapIndicator,
    marqueeScreen,
    showDimensions,
  ])

  const redrawRef = useRef(redrawCanvas)
  redrawRef.current = redrawCanvas

  const requestCanvasRedraw = useCallback(() => {
    if (redrawRafRef.current) return
    redrawRafRef.current = requestAnimationFrame(() => {
      redrawRafRef.current = 0
      redrawRef.current()
    })
  }, [])

  const scheduleViewportSync = useCallback(() => {
    window.clearTimeout(viewportSyncTimerRef.current)
    viewportSyncTimerRef.current = window.setTimeout(() => {
      setViewport({ ...viewportRef.current })
    }, 120)
  }, [])

  const applyZoomExtents = useCallback(() => {
    if (!zoomExtentsRef.current) return
    const canvas = canvasRef.current
    if (!canvas) return

    const entities = [...doc.entities]
    const preview = scenePreview
    if (preview) entities.push(preview)
    if (transformPreview) entities.push(...transformPreview)

    const bounds = boundsFromEntities(entities)
    const next = bounds
      ? fitViewportToExtents(canvas.width, canvas.height, bounds, showDimensions)
      : defaultViewport(canvas.height)

    if (!bounds) originAnchoredRef.current = true

    viewportRef.current = next
    setViewport(next)
    requestAnimationFrame(() => redrawRef.current())
  }, [doc.entities, scenePreview, transformPreview, showDimensions])

  const applyZoomExtentsRef = useRef(applyZoomExtents)
  applyZoomExtentsRef.current = applyZoomExtents

  useEffect(() => {
    if (!zoomExtents) return
    applyZoomExtents()
  }, [zoomExtents, applyZoomExtents])

  useEffect(() => {
    redrawCanvas()
  }, [redrawCanvas])

  useEffect(() => {
    return () => {
      if (redrawRafRef.current) cancelAnimationFrame(redrawRafRef.current)
      window.clearTimeout(viewportSyncTimerRef.current)
    }
  }, [])

  useEffect(() => {
    const wrap = wrapRef.current
    const canvas = canvasRef.current
    if (!wrap || !canvas) return

    const onWheelNative = (e: WheelEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (zoomExtentsRef.current) return
      const target = canvasRef.current
      if (!target) return
      const rect = target.getBoundingClientRect()
      const p = { x: e.clientX - rect.left, y: e.clientY - rect.top }
      const factor = Math.exp(-e.deltaY * 0.0012)
      viewportRef.current = zoomAt(viewportRef.current, p, factor)
      requestCanvasRedraw()
      scheduleViewportSync()
    }

    wrap.addEventListener('wheel', onWheelNative, { passive: false })
    return () => wrap.removeEventListener('wheel', onWheelNative)
  }, [requestCanvasRedraw, scheduleViewportSync])

  useEffect(() => {
    const wrap = wrapRef.current
    const canvas = canvasRef.current
    if (!wrap || !canvas) return

    const ro = new ResizeObserver(() => {
      const rect = wrap.getBoundingClientRect()
      const newWidth = Math.max(1, Math.floor(rect.width))
      const newHeight = Math.max(1, Math.floor(rect.height))
      const oldHeight = canvas.height
      canvas.width = newWidth
      canvas.height = newHeight

      if (zoomExtentsRef.current) {
        requestAnimationFrame(() => applyZoomExtentsRef.current())
        return
      }

      setViewport((vp) => {
        let next = vp
        if (!originAnchoredRef.current) {
          originAnchoredRef.current = true
          next = { ...vp, panPx: panForBottomLeftOrigin(newHeight) }
        } else if (oldHeight !== newHeight) {
          next = { ...vp, panPx: panPxAfterCanvasHeightChange(vp.panPx, oldHeight, newHeight) }
        }
        viewportRef.current = next
        requestAnimationFrame(() => redrawRef.current())
        return next
      })
    })
    ro.observe(wrap)
    return () => ro.disconnect()
  }, [])

  const screenFromPointer = (e: React.PointerEvent<HTMLCanvasElement>): Vec2 => {
    const rect = canvasRef.current!.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  const onPointerDown: React.PointerEventHandler<HTMLCanvasElement> = (e) => {
    if (!canvasRef.current || e.button !== 0) return
    if (readOnly && tool !== 'pan' && tool !== 'select') return
    canvasRef.current.setPointerCapture(e.pointerId)

    const pScreen = screenFromPointer(e)
    const pWorldRaw = screenToWorld(viewportRef.current, pScreen)

    if (tool === 'pan') {
      if (zoomExtentsRef.current) return
      panRef.current = { active: true, last: pScreen }
      return
    }

    if (tool === 'select') {
      selectRef.current = { active: true, start: pScreen }
      setMarqueeScreen({ a: pScreen, b: pScreen, mode: 'window' })
      return
    }

    if (tool === 'trim') {
      trimRef.current = { active: true, start: pScreen }
      setMarqueeScreen({ a: pScreen, b: pScreen, mode: 'window' })
      return
    }

    if (tool === 'move') {
      if (!selectedCount) return
      const p = resolvePoint(pWorldRaw)
      if (!editSession || editSession.kind !== tool) {
        setEditSession({ kind: tool, from: p })
      } else {
        const delta = sub(p, editSession.from)
        applyTranslate(delta)
        clearEditSession()
      }
      return
    }

    if (tool === 'rotate') {
      if (!selectedCount) return
      const p = resolvePoint(pWorldRaw)
      if (!editSession || editSession.kind !== 'rotate') {
        setEditSession({ kind: 'rotate', base: p })
        requestAnimationFrame(() => modifyInputRef.current?.focus())
      }
      return
    }

    if (tool === 'scale') {
      if (!selectedCount) return
      const p = resolvePoint(pWorldRaw)
      if (!editSession || editSession.kind !== 'scale') {
        setEditSession({ kind: 'scale', base: p })
        requestAnimationFrame(() => modifyInputRef.current?.focus())
      }
      return
    }

    if (tool === 'text') {
      const p = resolvePoint(pWorldRaw)
      setTextPlacement({ p })
      setTextInput('Label')
      setTextHeight(resolveDefaultTextHeight())
      setTextFontFamily(DEFAULT_TEXT_FONT)
      return
    }

    const snap = snapPoint(viewportRef.current, pWorldRaw, doc.entities, snapSettings)
    setSnapIndicator(snap.snapped ? snap.world : null)

    if (tool === 'line') {
      if (!draft || draft.kind !== 'line') {
        const start = resolvePoint(pWorldRaw, undefined, 'line', null)
        setDraft({ kind: 'line', start })
        setPreviewEnd(start)
        resetDimInput()
      } else {
        const end = applyDimsToCursor('line', draft.start, resolvePoint(pWorldRaw, draft.start, 'line', draft), dimInput)
        commitLine(draft.start, end)
        setDraft(null)
        setPreviewEnd(null)
        resetDimInput()
      }
      return
    }

    if (tool === 'rect') {
      if (!draft || draft.kind !== 'rect') {
        const start = resolvePoint(pWorldRaw, undefined, 'rect', null)
        setDraft({ kind: 'rect', start })
        setPreviewEnd(start)
        resetDimInput()
      } else {
        const end = applyDimsToCursor('rect', draft.start, resolvePoint(pWorldRaw, undefined, 'rect', draft), dimInput)
        commitRect(draft.start, end)
        setDraft(null)
        setPreviewEnd(null)
        resetDimInput()
      }
      return
    }

    if (tool === 'circle') {
      if (!draft || draft.kind !== 'circle') {
        const center = resolvePoint(pWorldRaw, undefined, 'circle', null)
        setDraft({ kind: 'circle', center })
        setPreviewEnd(center)
        resetDimInput()
      } else {
        const edge = applyDimsToCursor(
          'circle',
          draft.center,
          resolvePoint(pWorldRaw, draft.center, 'circle', draft),
          dimInput,
        )
        commitCircle(draft.center, edge)
        setDraft(null)
        setPreviewEnd(null)
        resetDimInput()
      }
    }
  }

  const onPointerMove: React.PointerEventHandler<HTMLCanvasElement> = (e) => {
    const pScreen = screenFromPointer(e)

    if (selectRef.current?.active) {
      const start = selectRef.current.start
      setMarqueeScreen({
        a: start,
        b: pScreen,
        mode: pScreen.x < start.x ? 'crossing' : 'window',
      })
      return
    }

    if (trimRef.current?.active) {
      const end = shiftRef.current ? squareMarqueeCorner(trimRef.current.start, pScreen) : pScreen
      setMarqueeScreen({ a: trimRef.current.start, b: end, mode: 'window' })
      return
    }

    if (panRef.current.active) {
      if (zoomExtentsRef.current) return
      const dx = pScreen.x - panRef.current.last.x
      const dy = pScreen.y - panRef.current.last.y
      panRef.current.last = pScreen
      viewportRef.current = {
        ...viewportRef.current,
        panPx: {
          x: viewportRef.current.panPx.x + dx,
          y: viewportRef.current.panPx.y + dy,
        },
      }
      requestCanvasRedraw()
      return
    }

    const pWorldRaw = screenToWorld(viewportRef.current, pScreen)
    const start =
      draft?.kind === 'line'
        ? draft.start
        : draft?.kind === 'circle'
          ? draft.center
          : undefined
    const resolved = resolvePoint(pWorldRaw, start)
    setCursorWorld(resolved)

    const snap = snapPoint(viewportRef.current, pWorldRaw, doc.entities, snapSettings)
    setSnapIndicator(snap.snapped ? snap.world : null)

    if (draft) updatePreviewFromCursor(resolved)
  }

  const onPointerUp: React.PointerEventHandler<HTMLCanvasElement> = (e) => {
    const wasPanning = panRef.current.active
    if (selectRef.current?.active) {
      const end = screenFromPointer(e)
      finishMarqueeSelect(selectRef.current.start, end)
      selectRef.current = null
      setMarqueeScreen(null)
    }
    if (trimRef.current?.active) {
      const end = screenFromPointer(e)
      finishTrimMarquee(trimRef.current.start, end)
      trimRef.current = null
      setMarqueeScreen(null)
    }
    panRef.current.active = false
    if (wasPanning) setViewport({ ...viewportRef.current })
  }

  const toggleLayer = (layerId: string) => {
    const updater = (d: CadDoc) => ({
      ...d,
      layers: d.layers.map((l) => (l.id === layerId ? { ...l, visible: !l.visible } : l)),
    })
    if (readOnly) setDoc(updater)
    else commitDoc(updater)
  }

  const setActiveLayer = (layerId: string) => {
    setDoc((d) => ({ ...d, activeLayerId: layerId }))
  }

  const addLayer = () => {
    const id = newId('layer')
    const colors = ['#63b3ff', '#ff6b6b', '#ffd166', '#06d6a0', '#c084fc']
    const color = colors[doc.layers.length % colors.length]
    commitDoc((d) => ({
      ...d,
      layers: [...d.layers, { id, name: `Layer ${d.layers.length + 1}`, color, visible: true }],
      activeLayerId: id,
    }))
  }

  const renameLayer = (layerId: string, name: string) => {
    const trimmed = name.trim()
    if (!trimmed) return
    commitDoc((d) => ({
      ...d,
      layers: d.layers.map((l) => (l.id === layerId ? { ...l, name: trimmed } : l)),
    }))
  }

  const setLayerColor = (layerId: string, color: string) => {
    commitDoc((d) => ({
      ...d,
      layers: d.layers.map((l) => (l.id === layerId ? { ...l, color } : l)),
    }))
  }

  const commitLayerRename = () => {
    if (editingLayerId) renameLayer(editingLayerId, editingLayerName)
    setEditingLayerId(null)
    setEditingLayerName('')
  }

  const cancelLayerRename = () => {
    setEditingLayerId(null)
    setEditingLayerName('')
  }

  const openLayerColorPicker = (layerId: string, color: string) => {
    layerColorPickIdRef.current = layerId
    const input = layerColorInputRef.current
    if (!input) return
    input.value = color
    input.click()
  }

  const requestDeleteLayer = (layerId: string) => {
    if (doc.layers.length <= 1) return
    const layer = doc.layers.find((l) => l.id === layerId)
    if (!layer) return
    const entityCount = doc.entities.filter((e) => e.layerId === layerId).length
    const entityNote =
      entityCount > 0
        ? ` This will also delete ${entityCount} object${entityCount === 1 ? '' : 's'} on this layer.`
        : ''
    if (!window.confirm(`Delete layer "${layer.name}"?${entityNote}`)) return
    commitDoc((d) => {
      if (d.layers.length <= 1) return d
      const remaining = d.layers.filter((l) => l.id !== layerId)
      return {
        ...d,
        layers: remaining,
        activeLayerId: d.activeLayerId === layerId ? remaining[0].id : d.activeLayerId,
        entities: d.entities.filter((e) => e.layerId !== layerId),
      }
    })
    if (editingLayerId === layerId) {
      setEditingLayerId(null)
      setEditingLayerName('')
    }
  }

  const submitText = () => {
    if (!textPlacement) return
    commitText(textPlacement.p, textInput, textHeight, textFontFamily)
    setTextPlacement(null)
  }

  const textPreviewPx = Math.max(textHeight * viewport.zoom, 8)

  const dimFields = draftKind ? DIM_FIELDS_BY_KIND[draftKind] : []

  const handleDimValueChange = (field: DimField, raw: string) => {
    setDimInput((prev) => ({
      ...prev,
      values: { ...prev.values, [field]: raw },
    }))
    if (draft && cursorWorld) {
      const anchor = draft.kind === 'circle' ? draft.center : draft.start
      const nextValues = { ...dimInput.values, [field]: raw }
      const end = previewEndFromDraft(draft.kind, anchor, cursorWorld, effectiveLocked(nextValues, dimInput.locked))
      setPreviewEnd(end)
    }
  }

  const handleDimKeyDown = (field: DimField, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Tab') {
      e.preventDefault()
      if (draftKind && dimInput.activeIndex >= 0) {
        const fields = DIM_FIELDS_BY_KIND[draftKind]
        const activeField = fields[dimInput.activeIndex]
        applyDimField(activeField)
      }
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      applyDimField(field)
      return
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      cancelDraft()
    }
  }

  return (
    <div className="cadRoot">
      {readOnly && lockHolder && (
        <div className="cadBanner cadBannerView">
          View only — {lockHolder} is currently editing. You are seeing the latest saved version.
        </div>
      )}
      {!readOnly && canEdit && (
        <div className="cadBanner cadBannerEdit">You have edit access. Save to update the shared drawing.</div>
      )}
      <header className="cadTopbar">
        <div className="cadTitle">Simple CAD</div>
        <div className="cadTopbarRight">
          {userLabel && (
            <span className="cadMeta">
              User: <b>{userLabel}</b>
            </span>
          )}
          {lastSavedBy && (
            <span className="cadMeta">
              Last saved by: <b>{lastSavedBy}</b>
            </span>
          )}
          <span className="cadMeta">
            Units: <b>{doc.units}</b>
          </span>
          <span className="cadMeta">
            Tool: <b>{TOOL_LABELS[tool]}</b>
          </span>
          {selectedCount > 0 && (
            <span className="cadMeta">
              Selected: <b>{selectedCount}</b>
            </span>
          )}
          {canEdit && onSave && (
            <button
              type="button"
              className="cadBtnSmall cadSaveBtn"
              disabled={saving}
              onClick={() => void onSave(docRef.current)}
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          )}
          {onSignOut && (
            <button type="button" className="cadBtnSmall" onClick={onSignOut}>
              Sign out
            </button>
          )}
          {draft && !readOnly && (
            <button type="button" className="cadBtnSmall" onClick={cancelDraft}>
              Cancel (Esc)
            </button>
          )}
        </div>
      </header>
      {(saveError || lastSavedMessage) && (
        <div className={`cadStatus ${saveError ? 'cadStatusError' : 'cadStatusOk'}`}>
          {saveError ?? lastSavedMessage}
        </div>
      )}

      <div className="cadMain">
        <aside className="cadLeft">
          <div className="cadPanelTitle">Tools</div>
          <div className="cadToolGrid">
            {DRAW_TOOLS.map((t) => (
              <button
                key={t}
                type="button"
                className={tool === t ? 'cadBtn active' : 'cadBtn'}
                disabled={readOnly && t !== 'select' && t !== 'pan'}
                onClick={() => activateTool(t)}
              >
                {TOOL_LABELS[t]}
              </button>
            ))}
          </div>

          <div className="cadPanelTitle cadSpaced">Modify</div>
          <div className="cadToolGrid cadModifyGrid">
            {MODIFY_TOOLS.map((t) => {
              const disabled =
                readOnly ||
                (t === 'fillet' && !filletTarget) ||
                (t === 'offset' && offsettableSelected.length === 0) ||
                (SELECTION_MODIFY_TOOLS.includes(t) &&
                  t !== 'fillet' &&
                  t !== 'offset' &&
                  selectedCount === 0)
              return (
                <button
                  key={t}
                  type="button"
                  className={tool === t ? 'cadBtn active' : 'cadBtn'}
                  disabled={disabled}
                  onClick={() => activateTool(t)}
                >
                  {TOOL_LABELS[t]}
                </button>
              )
            })}
          </div>

          <div className="cadPanelTitle cadSpaced">Options</div>
          <label className="cadCheck">
            <input
              type="checkbox"
              checked={zoomExtents}
              onChange={(e) => setZoomExtents(e.target.checked)}
            />
            Zoom Extents
          </label>
          <label className="cadCheck">
            <input type="checkbox" checked={ortho} onChange={(e) => setOrtho(e.target.checked)} />
            Ortho mode (line/circle)
          </label>
          <label className="cadCheck">
            <input
              type="checkbox"
              checked={snapEndpoints}
              onChange={(e) => setSnapEndpoints(e.target.checked)}
            />
            Snap to endpoints
          </label>
          <label className="cadCheck">
            <input type="checkbox" checked={snapCenter} onChange={(e) => setSnapCenter(e.target.checked)} />
            Snap to circle center
          </label>
          <label className="cadCheck">
            <input
              type="checkbox"
              checked={showDimensions}
              onChange={(e) => setShowDimensions(e.target.checked)}
            />
            Show dimensions
          </label>

          <p className="cadHint">
            After first click: press <b>Tab</b> to focus dimension input. For rectangles,
            press <b>Tab</b> again to apply the next side. <b>Enter</b> also applies.
            Copy/paste: <b>⌘C / Ctrl+C</b>, <b>⌘V / Ctrl+V</b>.
            Undo/redo: <b>⌘Z / Ctrl+Z</b>, <b>⌘⇧Z / Ctrl+Shift+Z</b>.
          </p>
          {modifyHint && <p className="cadHint cadModifyHint">{modifyHint}</p>}
        </aside>

        <section className="cadCanvasWrap" ref={wrapRef}>
          <canvas
            ref={canvasRef}
            className="cadCanvas"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerLeave={onPointerUp}
          />

          {draft && draftKind && (
            <div className="cadCommandLine">
              <span className="cadCommandHint">Dimensions — Tab: apply (next side for rect) · Enter: apply</span>
              <div className="cadCommandFields">
                {dimFields.map((field, index) => (
                  <label
                    key={field}
                    className={
                      dimInput.activeIndex === index ? 'cadCommandField active' : 'cadCommandField'
                    }
                  >
                    <span>{dimFieldLabel(field, doc.units)}</span>
                    <input
                      ref={(el) => {
                        dimInputRefs.current[field] = el
                      }}
                      type="text"
                      inputMode="decimal"
                      value={dimInput.values[field] ?? ''}
                      placeholder="—"
                      onFocus={() => setDimInput((prev) => ({ ...prev, activeIndex: index }))}
                      onChange={(e) => handleDimValueChange(field, e.target.value)}
                      onKeyDown={(e) => handleDimKeyDown(field, e)}
                    />
                  </label>
                ))}
              </div>
            </div>
          )}

          {(tool === 'fillet' || tool === 'offset' || tool === 'scale' || tool === 'rotate') && (
            <div className="cadCommandLine">
              <span className="cadCommandHint">
                {tool === 'fillet'
                  ? filletRange
                    ? `Radius range: ${filletRange.min.toFixed(2)} – ${filletRange.max.toFixed(2)} ${doc.units} · Enter to apply`
                    : filletTarget?.kind === 'rect'
                      ? 'Rectangle is too small to fillet.'
                      : 'Selected lines cannot be filleted.'
                  : tool === 'scale'
                    ? editSession?.kind === 'scale'
                      ? 'Scale — Enter: apply ratio (2 = double, 0.5 = half)'
                      : 'Scale — click base point on canvas first'
                    : tool === 'rotate'
                      ? editSession?.kind === 'rotate'
                        ? 'Rotate — Enter: apply angle (positive = clockwise, degrees)'
                        : 'Rotate — click base point on canvas first'
                      : 'Offset — Enter: apply distance'}
              </span>
              <div className="cadCommandFields">
                <label className="cadCommandField active">
                  <span>
                    {tool === 'fillet'
                      ? `Radius (${doc.units})`
                      : tool === 'scale'
                        ? 'Scale ratio'
                        : tool === 'rotate'
                          ? 'Angle (° clockwise)'
                          : `Distance (${doc.units})`}
                  </span>
                  <input
                    ref={modifyInputRef}
                    type="text"
                    inputMode="decimal"
                    value={modifyInput}
                    placeholder={tool === 'scale' ? '1' : tool === 'rotate' ? '0' : '—'}
                    disabled={
                      (tool === 'fillet' && !filletRange) ||
                      (tool === 'scale' && editSession?.kind !== 'scale') ||
                      (tool === 'rotate' && editSession?.kind !== 'rotate')
                    }
                    onChange={(e) => setModifyInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        submitModifyInput()
                      }
                    }}
                  />
                </label>
                {tool === 'fillet' && filletRange && filletRadiusValue != null && (
                  <input
                    className="cadCommandRange"
                    type="range"
                    min={filletRange.min}
                    max={filletRange.max}
                    step={Math.max((filletRange.max - filletRange.min) / 200, 1e-4)}
                    value={filletRadiusValue}
                    onChange={(e) => setModifyInput(Number(e.target.value).toFixed(2))}
                  />
                )}
              </div>
            </div>
          )}

          {modifyHint && MODIFY_TOOLS.includes(tool) && (
            <div className="cadCanvasOverlay">{modifyHint}</div>
          )}

          {textPlacement && (() => {
            const anchor = worldToScreen(viewport, textPlacement.p)
            return (
              <div
                className="cadTextPlacementUi"
                style={{ left: anchor.x, top: anchor.y + 12 }}
              >
                <div className="cadTextPreviewFloat">
                  <span className="cadTextPreviewLabel">Preview</span>
                  <div
                    className="cadTextPreviewSample"
                    style={{
                      fontFamily: textFontFamily,
                      fontSize: `${textPreviewPx}px`,
                    }}
                  >
                    {textInput.trim() || 'Sample text'}
                  </div>
                  <span className="cadTextPreviewMeta">
                    {textHeight.toFixed(2)} {doc.units} at current zoom
                  </span>
                </div>
                <div className="cadTextDialog">
                  <div className="cadTextDialogFields">
                    <input
                      autoFocus
                      value={textInput}
                      onChange={(e) => setTextInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') submitText()
                        if (e.key === 'Escape') setTextPlacement(null)
                      }}
                      placeholder="Enter text"
                    />
                    <label className="cadTextOption">
                      <span>Font</span>
                      <select
                        value={textFontFamily}
                        onChange={(e) => setTextFontFamily(e.target.value)}
                      >
                        {TEXT_FONT_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="cadTextOption">
                      <span>Height ({doc.units})</span>
                      <input
                        type="number"
                        min={0.1}
                        step={0.5}
                        value={textHeight}
                        onChange={(e) => {
                          const val = Number.parseFloat(e.target.value)
                          if (Number.isFinite(val) && val > 0) setTextHeight(val)
                        }}
                      />
                    </label>
                  </div>
                  <button type="button" className="cadBtnSmall" onClick={submitText}>
                    Place
                  </button>
                </div>
              </div>
            )
          })()}
        </section>

        <aside className="cadRight">
          <input
            ref={layerColorInputRef}
            type="color"
            className="cadLayerColorInput"
            aria-hidden
            tabIndex={-1}
            onChange={(e) => {
              const layerId = layerColorPickIdRef.current
              if (layerId) setLayerColor(layerId, e.target.value)
            }}
          />
          <div className="cadPanelTitle cadLayerHeader">
            <span>Layers</span>
            {!readOnly && (
              <button type="button" className="cadBtnSmall" onClick={addLayer}>
                +
              </button>
            )}
          </div>
          <div className="cadLayerList">
            {doc.layers.map((layer) => (
              <div
                key={layer.id}
                className={layer.id === doc.activeLayerId ? 'cadLayer active' : 'cadLayer'}
                onClick={() => setActiveLayer(layer.id)}
                onKeyDown={() => {}}
                role="button"
                tabIndex={0}
              >
                <input
                  type="checkbox"
                  checked={layer.visible}
                  onChange={(e) => {
                    e.stopPropagation()
                    toggleLayer(layer.id)
                  }}
                  onClick={(e) => e.stopPropagation()}
                />
                <button
                  type="button"
                  className="swatch"
                  style={{ background: layer.color }}
                  aria-label={`Change color for ${layer.name}`}
                  disabled={readOnly}
                  onClick={(e) => {
                    e.stopPropagation()
                    if (!readOnly) openLayerColorPicker(layer.id, layer.color)
                  }}
                />
                {editingLayerId === layer.id && !readOnly ? (
                  <input
                    type="text"
                    className="cadLayerNameInput"
                    value={editingLayerName}
                    onChange={(e) => setEditingLayerName(e.target.value)}
                    onBlur={commitLayerRename}
                    onKeyDown={(e) => {
                      e.stopPropagation()
                      if (e.key === 'Enter') commitLayerRename()
                      if (e.key === 'Escape') cancelLayerRename()
                    }}
                    onClick={(e) => e.stopPropagation()}
                    autoFocus
                  />
                ) : (
                  <button
                    type="button"
                    className="name"
                    disabled={readOnly}
                    onClick={(e) => {
                      e.stopPropagation()
                      if (readOnly) return
                      setEditingLayerId(layer.id)
                      setEditingLayerName(layer.name)
                    }}
                  >
                    {layer.name}
                  </button>
                )}
                {!readOnly && doc.layers.length > 1 && (
                  <button
                    type="button"
                    className="cadLayerDelete"
                    aria-label={`Delete ${layer.name}`}
                    onClick={(e) => {
                      e.stopPropagation()
                      requestDeleteLayer(layer.id)
                    }}
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
          </div>

          {saveLogs.length > 0 && (
            <>
              <div className="cadSaveLogHeader cadSpaced">
                <div className="cadPanelTitle">Save log</div>
                {canEdit && onClearSaveLogs && (
                  <button
                    type="button"
                    className="cadBtnSmall cadSaveLogClear"
                    onClick={() => void onClearSaveLogs()}
                  >
                    Clear all
                  </button>
                )}
              </div>
              <ul className="cadSaveLogList">
                {saveLogs.map((entry) => (
                  <li key={entry.id} className="cadSaveLogItem">
                    <span className="cadSaveLogWho">{entry.name || entry.email}</span>
                    <span className="cadSaveLogWhen">{formatLogTime(entry.at)}</span>
                    {canEdit && onDeleteSaveLog && (
                      <button
                        type="button"
                        className="cadSaveLogDelete"
                        aria-label={`Delete save log v${entry.version}`}
                        onClick={() => void onDeleteSaveLog(entry.id)}
                      >
                        ×
                      </button>
                    )}
                    <span className="cadSaveLogVer">v{entry.version}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </aside>
      </div>
    </div>
  )
}
