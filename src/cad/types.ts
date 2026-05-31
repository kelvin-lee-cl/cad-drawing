export type Id = string

export type Units = 'mm' | 'inch'

export type Vec2 = { x: number; y: number }

export type CadLayer = {
  id: Id
  name: string
  color: string
  visible: boolean
}

export type BaseEntity = {
  id: Id
  layerId: Id
  selected?: boolean
}

export type LineFilletArc = {
  c: Vec2
  r: number
  end: Vec2
  corner: Vec2
  through: Vec2
}

export type LineEntity = BaseEntity & {
  type: 'line'
  a: Vec2
  b: Vec2
  filletArc?: LineFilletArc
}

export type RectEntity = BaseEntity & {
  type: 'rect'
  a: Vec2
  b: Vec2
  /** Corner fillet radius (same on all four corners). */
  filletR?: number
}

export type CircleEntity = BaseEntity & {
  type: 'circle'
  c: Vec2
  r: number
}

export type TextEntity = BaseEntity & {
  type: 'text'
  p: Vec2
  text: string
  height: number
  fontFamily?: string
  rotationDeg?: number
}

export type ArcEntity = BaseEntity & {
  type: 'arc'
  c: Vec2
  r: number
  startDeg: number
  endDeg: number
}

export type CadEntity = LineEntity | RectEntity | CircleEntity | TextEntity | ArcEntity

export type Tool =
  | 'select'
  | 'move'
  | 'rotate'
  | 'scale'
  | 'trim'
  | 'fillet'
  | 'offset'
  | 'pan'
  | 'line'
  | 'rect'
  | 'circle'
  | 'text'

export type Viewport = {
  panPx: Vec2
  zoom: number // px per world unit
}

export type CadDoc = {
  units: Units
  worldUnitsLabel: string
  layers: CadLayer[]
  activeLayerId: Id
  entities: CadEntity[]
}

export type ImportUnitsConfig = {
  units: Units
  worldUnitsLabel: string
  scaleToWorld: number // multiply DXF units by this to convert into our world units
}

