import type { Elements, RenderSurface } from 'claude-code'

import { tone } from './format'
import type { Part } from './format'

// The band is raised on the terminal and the desktop only; every surface's table has Box and Text.
export type Els = Elements[RenderSurface]

/** What draws and the elements it draws with: bars are text in the terminal, SVG on the desktop. */
export type Canvas = { els: Els; surface: RenderSurface }

export type Cell = { text: string; color?: string; dim?: boolean; bold?: boolean }

/**
 * A table column: `width` in cells (the least, for the one that `grow`s), `priority` the order
 * columns give way in when the band is narrow (lowest first; absent never gives way).
 */
export type Column = { title: string; width: number; align?: 'left' | 'right'; grow?: boolean; priority?: number }

export const ACCENT = 'claude'
const BAR_FILL = 'suggestion'
const SEPARATOR = ' │ '

// Symbols the terminal draws two cells wide although they sit below the emoji planes.
const WIDE = new Set([0x23f3, 0x231b, 0x26a1, 0x26fd, 0x2705, 0x274c, 0x2b50])

/** Cells a string takes in the terminal: emoji count two, joiners and selectors none. */
export const cellWidth = (text: string) => {
  let width = 0
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0
    if (cp === 0xfe0f || cp === 0x200d) continue
    width += cp >= 0x1f000 || WIDE.has(cp) ? 2 : 1
  }
  return width
}

const tableWidth = (columns: Column[]) => columns.reduce((sum, c) => sum + c.width, 0) + SEPARATOR.length * (columns.length - 1)

/** Drops the lowest-priority columns until the table, separators included, fits `room` cells. */
export const fitColumns = (columns: Column[], room: number) => {
  let kept = columns
  while (tableWidth(kept) > room) {
    const droppable = kept.filter(c => c.priority !== undefined)
    if (droppable.length === 0) break
    const lowest = droppable.reduce((a, b) => ((a.priority ?? 0) <= (b.priority ?? 0) ? a : b))
    kept = kept.filter(c => c !== lowest)
  }
  // The growing column takes what the others leave.
  const spare = Math.max(0, room - tableWidth(kept))
  return kept.map(c => (c.grow ? { ...c, width: c.width + spare } : c))
}

const cellBox = (els: Els, column: Column, cell: Cell) => {
  const { Box, Text } = els
  return (
    <Box width={column.width} flexShrink={0} justifyContent={column.align === 'right' ? 'flex-end' : 'flex-start'}>
      <Text wrap="truncate-end" color={cell.color} dimColor={cell.dim} bold={cell.bold}>
        {cell.text}
      </Text>
    </Box>
  )
}

const tableRow = (els: Els, columns: Column[], cells: (c: Column) => Cell) => {
  const { Box, Text } = els
  return (
    <Box flexDirection="row">
      {columns.map((c, i) => (
        <Box flexDirection="row">
          {i > 0 && <Text dimColor>{SEPARATOR}</Text>}
          {cellBox(els, c, cells(c))}
        </Box>
      ))}
    </Box>
  )
}

/**
 * A ruled table: a bold header, a `─┼─` rule under it and one row per entry, every column cut to
 * its width. Cells are keyed by column title, so a column dropped for room drops its cells too.
 */
export const table = (els: Els, columns: Column[], rows: Record<string, Cell>[], room: number) => {
  const { Box, Text } = els
  const kept = fitColumns(columns, room)
  return (
    <Box flexDirection="column">
      {tableRow(els, kept, c => ({ text: c.title, bold: true, dim: true }))}
      <Box flexDirection="row">
        {kept.map((c, i) => (
          <Box flexDirection="row">
            {i > 0 && <Text dimColor>{'─┼─'}</Text>}
            <Box width={c.width} flexShrink={0}>
              <Text dimColor wrap="truncate-end">{'─'.repeat(c.width)}</Text>
            </Box>
          </Box>
        ))}
      </Box>
      {rows.map(row => tableRow(els, kept, c => row[c.title] ?? { text: '' }))}
    </Box>
  )
}

/** A section rule across the frame: `── 🔥 TOKENS ─────────── note ──`. */
export const rule = (els: Els, title: string, note: string, room: number) => {
  const { Box, Text } = els
  const tail = note === '' ? '──' : ` ${note} ──`
  const fill = Math.max(2, room - cellWidth(`── ${title} `) - cellWidth(tail))
  return (
    <Box flexDirection="row">
      <Text dimColor>{'── '}</Text>
      <Text bold color={ACCENT}>{title}</Text>
      <Text dimColor wrap="truncate-end">{` ${'─'.repeat(fill)}${tail}`}</Text>
    </Box>
  )
}

/** Parts joined by dim middots; a warning part in the warning colour, a strong one bold. */
export const parts = (els: Els, list: Part[]) => {
  const { Box, Text } = els
  return (
    <Box flexDirection="row" flexWrap="wrap">
      {list.map((p, i) => (
        <Box flexDirection="row">
          {i > 0 && <Text dimColor>{' · '}</Text>}
          <Text
            color={p.emphasis === 'warning' ? 'warning' : p.color}
            bold={p.emphasis === 'strong'}
            dimColor={p.emphasis === undefined && p.color === undefined}
          >
            {p.text}
          </Text>
        </Box>
      ))}
    </Box>
  )
}

// Drawn as an image on the desktop, so it cannot follow the theme: a translucent track reads on both.
const svgBar = (percent: number, width: number) => {
  const fill = percent >= 95 ? '#e5484d' : percent >= 80 ? '#e0a030' : '#2f7de1'
  const filled = Math.round((Math.min(percent, 100) / 100) * width)
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="8" viewBox="0 0 ${width} 8">` +
    `<rect width="${width}" height="8" rx="4" fill="#808080" fill-opacity="0.3"/>` +
    `<rect width="${filled}" height="8" rx="4" fill="${fill}"/></svg>`
  )
}

const EIGHTHS = ['', '▏', '▎', '▍', '▌', '▋', '▊', '▉']

/** `cells` of bar at an eighth of a cell's resolution: whole blocks, one partial, the dim track. */
export const blocks = (percent: number, cells: number) => {
  const eighths = Math.round((Math.max(0, Math.min(percent, 100)) / 100) * cells * 8)
  const whole = Math.floor(eighths / 8)
  const partial = EIGHTHS[eighths % 8] ?? ''
  return { filled: '█'.repeat(whole) + partial, track: '░'.repeat(Math.max(0, cells - whole - (partial ? 1 : 0))) }
}

/** A bar `cells` wide: blocks in the terminal, an SVG bar on the desktop. */
export const gauge = (canvas: Canvas, name: string, percent: number, cells: number) => {
  const { Box, Text } = canvas.els
  if (canvas.surface === 'desktop' && 'Svg' in canvas.els) {
    const { Svg } = canvas.els
    const px = cells * 9
    return <Svg source={svgBar(percent, px)} alt={`${name} ${percent}% used`} width={px} height={8} />
  }
  const bar = blocks(percent, cells)
  return (
    <Box flexDirection="row" flexShrink={0}>
      {bar.filled !== '' && <Text color={tone(percent) ?? BAR_FILL}>{bar.filled}</Text>}
      {bar.track !== '' && <Text dimColor>{bar.track}</Text>}
    </Box>
  )
}

/** The cells a meter takes besides its bar: icon, label, percentage and detail. */
export const meterChrome = (label: string, detail: string) => cellWidth(label) + 1 + 1 + 4 + (detail === '' ? 0 : 1 + cellWidth(detail))

/** `⛽ CTX ███████▍░░░░  29% 289k/1M`: a label, a bar, the percentage and a dim detail. */
export const meter = (canvas: Canvas, label: string, percent: number | null, detail: string, cells: number) => {
  const { Box, Text } = canvas.els
  return (
    <Box flexDirection="row" flexShrink={0}>
      <Text bold>{`${label} `}</Text>
      {percent === null ? <Text dimColor>{'─'.repeat(cells)}</Text> : gauge(canvas, label, percent, cells)}
      <Box width={5} justifyContent="flex-end" flexShrink={0}>
        <Text bold color={percent === null ? undefined : tone(percent)} dimColor={percent === null}>
          {percent === null ? '—' : `${percent}%`}
        </Text>
      </Box>
      {detail !== '' && <Text dimColor>{` ${detail}`}</Text>}
    </Box>
  )
}

const SPARKS = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█']

/** A sparkline of `values`, each against the largest; a zero is the lowest bar. */
export const sparkline = (values: number[]) => {
  const top = Math.max(0, ...values)
  return values.map(v => (top === 0 ? SPARKS[0] : SPARKS[Math.min(7, Math.floor((v / top) * 7.999))])).join('')
}
