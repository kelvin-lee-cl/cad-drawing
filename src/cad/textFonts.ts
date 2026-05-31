export const TEXT_FONT_OPTIONS = [
  { label: 'System', value: 'system-ui, sans-serif' },
  { label: 'Sans-serif', value: 'sans-serif' },
  { label: 'Serif', value: 'serif' },
  { label: 'Monospace', value: 'ui-monospace, monospace' },
  { label: 'Arial', value: 'Arial, sans-serif' },
  { label: 'Helvetica', value: 'Helvetica, Arial, sans-serif' },
  { label: 'Georgia', value: 'Georgia, serif' },
  { label: 'Times New Roman', value: '"Times New Roman", Times, serif' },
  { label: 'Courier New', value: '"Courier New", Courier, monospace' },
] as const

export const DEFAULT_TEXT_FONT = TEXT_FONT_OPTIONS[0].value

/** Fraction of viewport height used for default text size on screen. */
export const DEFAULT_TEXT_HEIGHT_RATIO = 0.022

export function defaultTextHeight(zoom: number, canvasHeightPx: number): number {
  const targetScreenPx = canvasHeightPx * DEFAULT_TEXT_HEIGHT_RATIO
  return targetScreenPx / zoom
}

export function textFontCss(fontFamily?: string): string {
  return fontFamily ?? DEFAULT_TEXT_FONT
}
